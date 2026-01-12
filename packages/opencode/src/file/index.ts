import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { $ } from "bun"
import type { BunFile } from "bun"
import { formatPatch, structuredPatch } from "diff"
import path from "path"
import fs from "fs"
import ignore from "ignore"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Ripgrep } from "./ripgrep"
import fuzzysort from "fuzzysort"
import { Global } from "../global"
import { FileWatcher } from "./watcher"
import { Flag } from "../flag/flag"
import { FileIgnore } from "./ignore"

export namespace File {
  const log = Log.create({ service: "file" })

  export const Info = z
    .object({
      path: z.string(),
      added: z.number().int(),
      removed: z.number().int(),
      status: z.enum(["added", "deleted", "modified"]),
    })
    .meta({
      ref: "File",
    })

  export type Info = z.infer<typeof Info>

  export const Node = z
    .object({
      name: z.string(),
      path: z.string(),
      absolute: z.string(),
      type: z.enum(["file", "directory"]),
      ignored: z.boolean(),
    })
    .meta({
      ref: "FileNode",
    })
  export type Node = z.infer<typeof Node>

  export const Content = z
    .object({
      type: z.literal("text"),
      content: z.string(),
      diff: z.string().optional(),
      patch: z
        .object({
          oldFileName: z.string(),
          newFileName: z.string(),
          oldHeader: z.string().optional(),
          newHeader: z.string().optional(),
          hunks: z.array(
            z.object({
              oldStart: z.number(),
              oldLines: z.number(),
              newStart: z.number(),
              newLines: z.number(),
              lines: z.array(z.string()),
            }),
          ),
          index: z.string().optional(),
        })
        .optional(),
      encoding: z.literal("base64").optional(),
      mimeType: z.string().optional(),
    })
    .meta({
      ref: "FileContent",
    })
  export type Content = z.infer<typeof Content>

  async function shouldEncode(file: BunFile): Promise<boolean> {
    const type = file.type?.toLowerCase()
    log.info("shouldEncode", { type })
    if (!type) return false

    if (type.startsWith("text/")) return false
    if (type.includes("charset=")) return false

    const parts = type.split("/", 2)
    const top = parts[0]
    const rest = parts[1] ?? ""
    const sub = rest.split(";", 1)[0]

    const tops = ["image", "audio", "video", "font", "model", "multipart"]
    if (tops.includes(top)) return true

    const bins = [
      "zip",
      "gzip",
      "bzip",
      "compressed",
      "binary",
      "pdf",
      "msword",
      "powerpoint",
      "excel",
      "ogg",
      "exe",
      "dmg",
      "iso",
      "rar",
    ]
    if (bins.some((mark) => sub.includes(mark))) return true

    return false
  }

  export const Event = {
    Edited: BusEvent.define(
      "file.edited",
      z.object({
        file: z.string(),
      }),
    ),
  }

  const state = Instance.state(
    async () => {
      type Entry = { files: string[]; dirs: string[] }
      const cache: Entry = { files: [], dirs: [] }
      const fetching = { value: false }
      const dirty = { value: true }
      const last = { value: 0 }
      const useWatcher = Flag.OPENCODE_EXPERIMENTAL_FILEWATCHER && !Flag.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER
      const interval = useWatcher ? 120000 : 5000

      const fileIndex = new Map<string, number>()
      const dirIndex = new Map<string, number>()
      const dirCount = new Map<string, number>()

      const isGlobalHome = Instance.directory === Global.Path.home && Instance.project.id === "global"
      const subs: Array<() => void> = []

      const resetCache = () => {
        cache.files.length = 0
        cache.dirs.length = 0
        fileIndex.clear()
        dirIndex.clear()
        dirCount.clear()
      }

      const addDir = (dir: string) => {
        if (dirIndex.has(dir)) return
        cache.dirs.push(dir)
        dirIndex.set(dir, cache.dirs.length - 1)
      }

      const removeDir = (dir: string) => {
        const idx = dirIndex.get(dir)
        if (idx === undefined) return
        const last = cache.dirs.pop()
        dirIndex.delete(dir)
        if (!last) return
        if (last !== dir) {
          cache.dirs[idx] = last
          dirIndex.set(last, idx)
        }
      }

      const bumpDirs = (file: string, delta: number) => {
        const parts = file.split(path.sep)
        const count = parts.length - 1
        if (count <= 0) return
        const acc: string[] = []
        for (const part of parts.slice(0, count)) {
          acc.push(part)
          const dir = acc.join(path.sep) + "/"
          const current = dirCount.get(dir)
          const base = current ?? 0
          const next = base + delta
          if (next <= 0) {
            dirCount.delete(dir)
            removeDir(dir)
            continue
          }
          dirCount.set(dir, next)
          if (current === undefined) addDir(dir)
        }
      }

      const addFile = (file: string) => {
        if (fileIndex.has(file)) return
        cache.files.push(file)
        fileIndex.set(file, cache.files.length - 1)
        bumpDirs(file, 1)
      }

      const removeFile = (file: string) => {
        const idx = fileIndex.get(file)
        if (idx === undefined) return
        const last = cache.files.pop()
        fileIndex.delete(file)
        if (!last) return
        if (last !== file) {
          cache.files[idx] = last
          fileIndex.set(last, idx)
        }
        bumpDirs(file, -1)
      }

      const markDirty = () => {
        dirty.value = true
      }

      const applyUpdate = async (input: { file: string; event: "add" | "change" | "unlink" }) => {
        if (isGlobalHome) {
          markDirty()
          return
        }
        const full = path.resolve(input.file)
        if (!Filesystem.contains(Instance.directory, full)) {
          markDirty()
          return
        }
        const relative = path.relative(Instance.directory, full)
        if (!relative || relative === ".") return
        if (FileIgnore.match(relative)) return
        if (input.event === "unlink") {
          removeFile(relative)
          return
        }
        if (input.event === "change" && fileIndex.has(relative)) return
        const stat = await fs.promises.stat(full).catch(() => undefined)
        if (!stat) return
        if (!stat.isFile()) return
        addFile(relative)
      }

      subs.push(
        Bus.subscribe(FileWatcher.Event.Updated, (payload) => {
          if (!useWatcher) {
            markDirty()
            return
          }
          void applyUpdate(payload.properties)
        }),
      )
      subs.push(
        Bus.subscribe(Event.Edited, (payload) => {
          if (!useWatcher) {
            markDirty()
            return
          }
          void applyUpdate({ file: payload.properties.file, event: "change" })
        }),
      )

      const fn = async () => {
        // Disable scanning if in root of file system
        if (Instance.directory === path.parse(Instance.directory).root) return
        fetching.value = true

        if (isGlobalHome) {
          const dirs = new Set<string>()
          const ignore = new Set<string>()

          if (process.platform === "darwin") ignore.add("Library")
          if (process.platform === "win32") ignore.add("AppData")

          const ignoreNested = new Set(["node_modules", "dist", "build", "target", "vendor"])
          const shouldIgnore = (name: string) => name.startsWith(".") || ignore.has(name)
          const shouldIgnoreNested = (name: string) => name.startsWith(".") || ignoreNested.has(name)

          const top = await fs.promises
            .readdir(Instance.directory, { withFileTypes: true })
            .catch(() => [] as fs.Dirent[])

          for (const entry of top) {
            if (!entry.isDirectory()) continue
            if (shouldIgnore(entry.name)) continue
            dirs.add(entry.name + "/")

            const base = path.join(Instance.directory, entry.name)
            const children = await fs.promises.readdir(base, { withFileTypes: true }).catch(() => [] as fs.Dirent[])
            for (const child of children) {
              if (!child.isDirectory()) continue
              if (shouldIgnoreNested(child.name)) continue
              dirs.add(entry.name + "/" + child.name + "/")
            }
          }

          resetCache()
          const sorted = Array.from(dirs).toSorted()
          for (const dir of sorted) {
            addDir(dir)
          }
          fetching.value = false
          dirty.value = false
          last.value = Date.now()
          return
        }

        resetCache()
        for await (const file of Ripgrep.files({ cwd: Instance.directory })) {
          addFile(file)
        }
        fetching.value = false
        dirty.value = false
        last.value = Date.now()
      }
      fn()

      return {
        async files() {
          if (!fetching.value) {
            const now = Date.now()
            const stale = dirty.value || now - last.value > interval
            if (stale) {
              fn()
            }
          }
          return cache
        },
        subs,
      }
    },
    async (entry) => {
      const state = await entry
      for (const unsub of state.subs) {
        unsub()
      }
    },
  )

  export function init() {
    state()
  }

  export async function status() {
    const project = Instance.project
    if (project.vcs !== "git") return []

    const diffOutput = await $`git diff --numstat --no-renames HEAD`.cwd(Instance.directory).quiet().nothrow().text()
    const diffLines = diffOutput.trim().split("\n").filter(Boolean)
    const stats = new Map<string, { added: number; removed: number }>()

    const parseNum = (value: string | undefined) => {
      if (!value || value === "-") return 0
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed)) return 0
      return parsed
    }

    for (const line of diffLines) {
      const parts = line.split("\t")
      const filepath = parts[2]
      if (!filepath) continue
      stats.set(filepath, {
        added: parseNum(parts[0]),
        removed: parseNum(parts[1]),
      })
    }

    const statusOutput = await $`git status --porcelain=v2 -z`.cwd(Instance.directory).quiet().nothrow().text()
    const entries = statusOutput.split("\0").filter(Boolean)
    const changedFiles: Info[] = []

    const parsePath = (entry: string, start: number) => {
      const parts = entry.split(" ")
      if (parts.length <= start) return ""
      return parts.slice(start).join(" ")
    }

    const statusType = (value: string) => {
      if (value.includes("D")) return "deleted" as const
      if (value.includes("A")) return "added" as const
      return "modified" as const
    }

    const countLines = async (relative: string) => {
      const full = path.join(Instance.directory, relative)
      const file = Bun.file(full)
      const size = file.size
      if (!Number.isFinite(size)) return 0
      if (size > 256 * 1024) return 0
      const content = await file.text().catch(() => "")
      if (!content) return 0
      return content.split("\n").length
    }

    for (const entry of entries) {
      if (entry.startsWith("? ")) {
        const filepath = entry.slice(2)
        const lines = await countLines(filepath)
        changedFiles.push({
          path: filepath,
          added: lines,
          removed: 0,
          status: "added",
        })
        continue
      }

      if (entry.startsWith("1 ")) {
        const parts = entry.split(" ")
        const code = parts[1] ?? ""
        const filepath = parsePath(entry, 8)
        if (!filepath) continue
        const stat = stats.get(filepath)
        changedFiles.push({
          path: filepath,
          added: stat?.added ?? 0,
          removed: stat?.removed ?? 0,
          status: statusType(code),
        })
        continue
      }

      if (entry.startsWith("2 ")) {
        const parts = entry.split(" ")
        const code = parts[1] ?? ""
        const filepath = parsePath(entry, 9)
        if (!filepath) continue
        const stat = stats.get(filepath)
        changedFiles.push({
          path: filepath,
          added: stat?.added ?? 0,
          removed: stat?.removed ?? 0,
          status: statusType(code),
        })
        continue
      }

      if (entry.startsWith("u ")) {
        const parts = entry.split(" ")
        const code = parts[1] ?? ""
        const filepath = parsePath(entry, 10)
        if (!filepath) continue
        const stat = stats.get(filepath)
        changedFiles.push({
          path: filepath,
          added: stat?.added ?? 0,
          removed: stat?.removed ?? 0,
          status: statusType(code),
        })
      }
    }

    return changedFiles.map((x) => ({
      ...x,
      path: path.relative(Instance.directory, x.path),
    }))
  }

  export async function read(file: string): Promise<Content> {
    using _ = log.time("read", { file })
    const project = Instance.project
    const full = path.join(Instance.directory, file)

    // TODO: Filesystem.contains is lexical only - symlinks inside the project can escape.
    // TODO: On Windows, cross-drive paths bypass this check. Consider realpath canonicalization.
    if (!Filesystem.contains(Instance.directory, full)) {
      throw new Error(`Access denied: path escapes project directory`)
    }

    const bunFile = Bun.file(full)

    if (!(await bunFile.exists())) {
      return { type: "text", content: "" }
    }

    const encode = await shouldEncode(bunFile)

    if (encode) {
      const buffer = await bunFile.arrayBuffer().catch(() => new ArrayBuffer(0))
      const content = Buffer.from(buffer).toString("base64")
      const mimeType = bunFile.type || "application/octet-stream"
      return { type: "text", content, mimeType, encoding: "base64" }
    }

    const content = await bunFile
      .text()
      .catch(() => "")
      .then((x) => x.trim())

    if (project.vcs === "git") {
      let diff = await $`git diff ${file}`.cwd(Instance.directory).quiet().nothrow().text()
      if (!diff.trim()) diff = await $`git diff --staged ${file}`.cwd(Instance.directory).quiet().nothrow().text()
      if (diff.trim()) {
        const original = await $`git show HEAD:${file}`.cwd(Instance.directory).quiet().nothrow().text()
        const patch = structuredPatch(file, file, original, content, "old", "new", {
          context: Infinity,
          ignoreWhitespace: true,
        })
        const diff = formatPatch(patch)
        return { type: "text", content, patch, diff }
      }
    }
    return { type: "text", content }
  }

  export async function list(dir?: string) {
    const exclude = [".git", ".DS_Store"]
    const project = Instance.project
    let ignored = (_: string) => false
    if (project.vcs === "git") {
      const ig = ignore()
      const gitignore = Bun.file(path.join(Instance.worktree, ".gitignore"))
      if (await gitignore.exists()) {
        ig.add(await gitignore.text())
      }
      const ignoreFile = Bun.file(path.join(Instance.worktree, ".ignore"))
      if (await ignoreFile.exists()) {
        ig.add(await ignoreFile.text())
      }
      ignored = ig.ignores.bind(ig)
    }
    const resolved = dir ? path.join(Instance.directory, dir) : Instance.directory

    // TODO: Filesystem.contains is lexical only - symlinks inside the project can escape.
    // TODO: On Windows, cross-drive paths bypass this check. Consider realpath canonicalization.
    if (!Filesystem.contains(Instance.directory, resolved)) {
      throw new Error(`Access denied: path escapes project directory`)
    }

    const nodes: Node[] = []
    for (const entry of await fs.promises
      .readdir(resolved, {
        withFileTypes: true,
      })
      .catch(() => [])) {
      if (exclude.includes(entry.name)) continue
      const fullPath = path.join(resolved, entry.name)
      const relativePath = path.relative(Instance.directory, fullPath)
      const type = entry.isDirectory() ? "directory" : "file"
      nodes.push({
        name: entry.name,
        path: relativePath,
        absolute: fullPath,
        type,
        ignored: ignored(type === "directory" ? relativePath + "/" : relativePath),
      })
    }
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }

  export async function search(input: { query: string; limit?: number; dirs?: boolean; type?: "file" | "directory" }) {
    const query = input.query.trim()
    const limit = input.limit ?? 100
    const kind = input.type ?? (input.dirs === false ? "file" : "all")
    log.info("search", { query, kind })

    const result = await state().then((x) => x.files())

    const hidden = (item: string) => {
      const normalized = item.replaceAll("\\", "/").replace(/\/+$/, "")
      return normalized.split("/").some((p) => p.startsWith(".") && p.length > 1)
    }
    const preferHidden = query.startsWith(".") || query.includes("/.")
    const sortHiddenLast = (items: string[]) => {
      if (preferHidden) return items
      const visible: string[] = []
      const hiddenItems: string[] = []
      for (const item of items) {
        const isHidden = hidden(item)
        if (isHidden) hiddenItems.push(item)
        if (!isHidden) visible.push(item)
      }
      return [...visible, ...hiddenItems]
    }
    if (!query) {
      if (kind === "file") return result.files.slice(0, limit)
      return sortHiddenLast(result.dirs.toSorted()).slice(0, limit)
    }

    const items =
      kind === "file" ? result.files : kind === "directory" ? result.dirs : [...result.files, ...result.dirs]

    const searchLimit = kind === "directory" && !preferHidden ? limit * 20 : limit
    const sorted = fuzzysort.go(query, items, { limit: searchLimit }).map((r) => r.target)
    const output = kind === "directory" ? sortHiddenLast(sorted).slice(0, limit) : sorted

    log.info("search", { query, kind, results: output.length })
    return output
  }
}

import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { Global } from "../global"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })

  const locks = new Map<string, Promise<void>>()
  const gc = new Map<string, number>()
  const GC_INTERVAL_MS = 24 * 60 * 60 * 1000
  const GC_PRUNE = "30.days.ago"

  async function withLock<T>(git: string, fn: () => Promise<T>): Promise<T> {
    const current = locks.get(git) ?? Promise.resolve()
    let release: () => void = () => {}
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    const chained = current.then(() => next)
    locks.set(git, chained)
    await current
    try {
      return await fn()
    } finally {
      release()
      if (locks.get(git) === chained) {
        locks.delete(git)
      }
    }
  }

  async function maybeGC(git: string) {
    const now = Date.now()
    const last = gc.get(git) ?? 0
    if (now - last < GC_INTERVAL_MS) return
    gc.set(git, now)
    const result = await $`git --git-dir ${git} gc --prune=${GC_PRUNE}`.quiet().cwd(Instance.directory).nothrow()
    if (result.exitCode !== 0) {
      log.warn("snapshot gc failed", { exitCode: result.exitCode })
    }
  }

  async function stageChanged(git: string) {
    const result =
      await $`git --git-dir ${git} --work-tree ${Instance.worktree} ls-files -m -o -d --exclude-standard -z`
        .quiet()
        .cwd(Instance.directory)
        .nothrow()
    if (result.exitCode !== 0) {
      await $`git --git-dir ${git} --work-tree ${Instance.worktree} add .`.quiet().cwd(Instance.directory).nothrow()
      return
    }
    const status = result.text()
    if (!status) return
    const proc = Bun.spawn(
      [
        "git",
        "--git-dir",
        git,
        "--work-tree",
        Instance.worktree,
        "add",
        "-A",
        "--pathspec-from-file=-",
        "--pathspec-file-nul",
      ],
      {
        cwd: Instance.directory,
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      },
    )
    const input = proc.stdin
    if (!input) return
    input.write(status)
    input.end()
    await proc.exited
  }

  export async function track() {
    if (Instance.project.vcs !== "git") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    return withLock(git, async () => {
      if (await fs.mkdir(git, { recursive: true })) {
        await $`git init`
          .env({
            ...process.env,
            GIT_DIR: git,
            GIT_WORK_TREE: Instance.worktree,
          })
          .quiet()
          .nothrow()
        // Configure git to not convert line endings on Windows
        await $`git --git-dir ${git} config core.autocrlf false`.quiet().nothrow()
        log.info("initialized")
      }
      await stageChanged(git)
      const hash = await $`git --git-dir ${git} --work-tree ${Instance.worktree} write-tree`
        .quiet()
        .cwd(Instance.directory)
        .nothrow()
        .text()
      log.info("tracking", { hash, cwd: Instance.directory, git })
      await maybeGC(git)
      return hash.trim()
    })
  }

  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
  })
  export type Patch = z.infer<typeof Patch>

  export async function patch(hash: string): Promise<Patch> {
    const git = gitdir()
    return withLock(git, async () => {
      await stageChanged(git)
      const result =
        await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --name-only ${hash} -- .`
          .quiet()
          .cwd(Instance.directory)
          .nothrow()

      // If git diff fails, return empty patch
      if (result.exitCode !== 0) {
        log.warn("failed to get diff", { hash, exitCode: result.exitCode })
        return { hash, files: [] }
      }

      const files = result.text()
      return {
        hash,
        files: files
          .trim()
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => path.join(Instance.worktree, x)),
      }
    })
  }

  export async function restore(snapshot: string) {
    log.info("restore", { commit: snapshot })
    const git = gitdir()
    await withLock(git, async () => {
      const result =
        await $`git --git-dir ${git} --work-tree ${Instance.worktree} read-tree ${snapshot} && git --git-dir ${git} --work-tree ${Instance.worktree} checkout-index -a -f`
          .quiet()
          .cwd(Instance.worktree)
          .nothrow()

      if (result.exitCode !== 0) {
        log.error("failed to restore snapshot", {
          snapshot,
          exitCode: result.exitCode,
          stderr: result.stderr.toString(),
          stdout: result.stdout.toString(),
        })
      }
    })
  }

  export async function revert(patches: Patch[]) {
    const git = gitdir()
    await withLock(git, async () => {
      const files = new Set<string>()
      for (const item of patches) {
        for (const file of item.files) {
          if (files.has(file)) continue
          log.info("reverting", { file, hash: item.hash })
          const result = await $`git --git-dir ${git} --work-tree ${Instance.worktree} checkout ${item.hash} -- ${file}`
            .quiet()
            .cwd(Instance.worktree)
            .nothrow()
          if (result.exitCode !== 0) {
            const relativePath = path.relative(Instance.worktree, file)
            const checkTree =
              await $`git --git-dir ${git} --work-tree ${Instance.worktree} ls-tree ${item.hash} -- ${relativePath}`
                .quiet()
                .cwd(Instance.worktree)
                .nothrow()
            if (checkTree.exitCode === 0 && checkTree.text().trim()) {
              log.info("file existed in snapshot but checkout failed, keeping", {
                file,
              })
            } else {
              log.info("file did not exist in snapshot, deleting", { file })
              await fs.unlink(file).catch(() => {})
            }
          }
          files.add(file)
        }
      }
    })
  }

  export async function diff(hash: string) {
    const git = gitdir()
    return withLock(git, async () => {
      await stageChanged(git)
      const result =
        await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff ${hash} -- .`
          .quiet()
          .cwd(Instance.worktree)
          .nothrow()

      if (result.exitCode !== 0) {
        log.warn("failed to get diff", {
          hash,
          exitCode: result.exitCode,
          stderr: result.stderr.toString(),
          stdout: result.stdout.toString(),
        })
        return ""
      }

      return result.text().trim()
    })
  }

  export const FileDiff = z
    .object({
      file: z.string(),
      before: z.string(),
      after: z.string(),
      additions: z.number(),
      deletions: z.number(),
    })
    .meta({
      ref: "FileDiff",
    })
  export type FileDiff = z.infer<typeof FileDiff>
  export async function diffFull(from: string, to: string): Promise<FileDiff[]> {
    const git = gitdir()
    return withLock(git, async () => {
      const result: FileDiff[] = []
      await stageChanged(git)
      for await (const line of $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --no-renames --numstat ${from} ${to} -- .`
        .quiet()
        .cwd(Instance.directory)
        .nothrow()
        .lines()) {
        if (!line) continue
        const [additions, deletions, file] = line.split("\t")
        const isBinaryFile = additions === "-" && deletions === "-"
        const before = isBinaryFile
          ? ""
          : await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} show ${from}:${file}`
              .quiet()
              .nothrow()
              .text()
        const after = isBinaryFile
          ? ""
          : await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} show ${to}:${file}`
              .quiet()
              .nothrow()
              .text()
        const added = isBinaryFile ? 0 : parseInt(additions)
        const deleted = isBinaryFile ? 0 : parseInt(deletions)
        result.push({
          file,
          before,
          after,
          additions: Number.isFinite(added) ? added : 0,
          deletions: Number.isFinite(deleted) ? deleted : 0,
        })
      }
      return result
    })
  }

  function gitdir() {
    const project = Instance.project
    return path.join(Global.Path.data, "snapshot", project.id)
  }
}

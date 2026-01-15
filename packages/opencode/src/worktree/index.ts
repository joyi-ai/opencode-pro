import { $ } from "bun"
import z from "zod"
import path from "path"
import fs from "fs/promises"
import { NamedError } from "@opencode-ai/util/error"
import { Log } from "@/util/log"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"

const log = Log.create({ service: "worktree" })

const ADJECTIVES = [
  "bright",
  "calm",
  "cool",
  "dark",
  "dry",
  "fast",
  "flat",
  "free",
  "fresh",
  "full",
  "gold",
  "green",
  "high",
  "kind",
  "late",
  "lean",
  "long",
  "loud",
  "low",
  "neat",
  "new",
  "old",
  "pale",
  "pure",
  "quick",
  "rare",
  "raw",
  "red",
  "rich",
  "safe",
  "slow",
  "soft",
  "strong",
  "sweet",
  "tall",
  "thin",
  "warm",
  "wide",
  "wild",
  "young",
]

const NOUNS = [
  "arc",
  "bay",
  "beam",
  "bird",
  "brook",
  "bush",
  "cloud",
  "cove",
  "creek",
  "dawn",
  "dew",
  "dusk",
  "fern",
  "fire",
  "flame",
  "flower",
  "fog",
  "frost",
  "gale",
  "galaxy",
  "gem",
  "grove",
  "haze",
  "hill",
  "lake",
  "leaf",
  "light",
  "meadow",
  "moon",
  "moss",
  "oak",
  "peak",
  "pine",
  "pond",
  "rain",
  "ridge",
  "river",
  "rock",
  "rose",
  "sky",
  "snow",
  "star",
  "stone",
  "stream",
  "sun",
  "tide",
  "tree",
  "valley",
  "wave",
  "wind",
  "wood",
]

export namespace Worktree {
  export const Info = z
    .object({
      name: z.string(),
      branch: z.string(),
      directory: z.string(),
    })
    .meta({ ref: "Worktree" })
  export type Info = z.infer<typeof Info>

  export const CreateInput = z
    .object({
      name: z.string().optional(),
      startCommand: z.string().optional(),
    })
    .meta({ ref: "WorktreeCreateInput" })
  export type CreateInput = z.infer<typeof CreateInput>

  export const NotGitProjectError = NamedError.create(
    "WorktreeNotGitProjectError",
    z.object({
      message: z.string(),
      directory: z.string(),
    }),
  )

  export const CreateFailedError = NamedError.create(
    "WorktreeCreateFailedError",
    z.object({
      message: z.string(),
      directory: z.string(),
      output: z.string().optional(),
    }),
  )

  export const StartCommandFailedError = NamedError.create(
    "WorktreeStartCommandFailedError",
    z.object({
      message: z.string(),
      directory: z.string(),
      command: z.string(),
      output: z.string().optional(),
    }),
  )

  export const DeleteFailedError = NamedError.create(
    "WorktreeDeleteFailedError",
    z.object({
      message: z.string(),
      directory: z.string(),
      output: z.string().optional(),
    }),
  )

  export const NotFoundError = NamedError.create(
    "WorktreeNotFoundError",
    z.object({
      message: z.string(),
      directory: z.string(),
    }),
  )

  function slugify(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30)
  }

  function generateName(base?: string): string {
    const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
    if (base) {
      const slug = slugify(base)
      if (slug) return `${slug}-${adjective}-${noun}`
    }
    return `${adjective}-${noun}`
  }

  async function branchExists(branch: string, cwd: string): Promise<boolean> {
    const result = await $`git show-ref --verify --quiet refs/heads/${branch}`.quiet().nothrow().cwd(cwd)
    return result.exitCode === 0
  }

  async function findUniqueName(
    projectID: string,
    baseName: string | undefined,
    worktreeRoot: string,
  ): Promise<{ name: string; directory: string; branch: string }> {
    const maxAttempts = 26

    for (let i = 0; i < maxAttempts; i++) {
      const name = generateName(baseName)
      const directory = path.join(Global.Path.data, "worktree", projectID, name)
      const branch = `opencode/${name}`

      const dirExists = await fs.stat(directory).catch(() => undefined)
      if (dirExists) continue

      const refExists = await branchExists(branch, worktreeRoot)
      if (refExists) continue

      return { name, directory, branch }
    }

    throw new CreateFailedError({
      message: `Failed to generate unique worktree name after ${maxAttempts} attempts`,
      directory: worktreeRoot,
    })
  }

  export async function create(input: CreateInput = {}): Promise<Info> {
    const project = Instance.project
    const worktreeRoot = Instance.worktree

    if (project.vcs !== "git") {
      throw new NotGitProjectError({
        message: "Worktrees are only supported for git projects",
        directory: Instance.directory,
      })
    }

    const { name, directory, branch } = await findUniqueName(project.id, input.name, worktreeRoot)

    log.info("creating worktree", { name, directory, branch, project: project.id })

    await fs.mkdir(path.dirname(directory), { recursive: true })

    const result = await $`git worktree add -b ${branch} ${directory}`.quiet().nothrow().cwd(worktreeRoot)

    if (result.exitCode !== 0) {
      const output = result.stderr.toString() || result.stdout.toString()
      throw new CreateFailedError({
        message: `Failed to create git worktree: ${output}`,
        directory: worktreeRoot,
        output,
      })
    }

    log.info("worktree created", { name, directory, branch })

    if (input.startCommand) {
      log.info("running start command", { command: input.startCommand, directory })
      const cmdResult = await $`${{ raw: input.startCommand }}`.quiet().nothrow().cwd(directory)

      if (cmdResult.exitCode !== 0) {
        const output = cmdResult.stderr.toString() || cmdResult.stdout.toString()
        throw new StartCommandFailedError({
          message: `Start command failed: ${output}`,
          directory,
          command: input.startCommand,
          output,
        })
      }
    }

    await Project.addSandbox(project.id, directory)

    return {
      name,
      branch,
      directory,
    }
  }

  export async function list(): Promise<string[]> {
    const project = Instance.project
    return Project.sandboxes(project.id)
  }

  export async function remove(directory: string): Promise<boolean> {
    const normalized = path.normalize(directory)
    const managedRoot = path.normalize(path.join(Global.Path.data, "worktree"))

    const isWindows = process.platform === "win32"
    const normalizedLower = isWindows ? normalized.toLowerCase() : normalized
    const managedRootLower = isWindows ? managedRoot.toLowerCase() : managedRoot

    if (!normalizedLower.startsWith(managedRootLower)) {
      throw new DeleteFailedError({
        message: "Can only delete managed worktrees",
        directory,
      })
    }

    const stat = await fs.stat(directory).catch(() => undefined)
    if (!stat?.isDirectory()) {
      throw new NotFoundError({
        message: "Worktree directory does not exist",
        directory,
      })
    }

    const relative = normalized.slice(managedRoot.length).replace(/^[/\\]+/, "")
    const parts = relative.split(/[/\\]/).filter(Boolean)
    if (parts.length < 2) {
      throw new DeleteFailedError({
        message: "Invalid managed worktree path",
        directory,
      })
    }
    const projectID = parts[0]

    const gitCommonDir = await $`git rev-parse --git-common-dir`
      .quiet()
      .nothrow()
      .cwd(directory)
      .text()
      .then((x) => x.trim())
      .catch(() => undefined)

    if (!gitCommonDir) {
      throw new DeleteFailedError({
        message: "Not a valid git worktree",
        directory,
      })
    }

    const mainRepoRoot = path.dirname(gitCommonDir)

    const removeResult = await $`git worktree remove --force ${directory}`.quiet().nothrow().cwd(mainRepoRoot)

    if (removeResult.exitCode !== 0) {
      const output = removeResult.stderr.toString() || removeResult.stdout.toString()
      log.warn("git worktree remove failed, attempting manual cleanup", { directory, output })

      await fs.rm(directory, { recursive: true, force: true }).catch((e) => {
        log.error("failed to remove worktree directory", { directory, error: e })
      })
    }

    await Project.removeSandbox(projectID, directory)

    log.info("worktree removed", { directory })

    return true
  }
}

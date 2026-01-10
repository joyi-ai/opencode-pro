import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Project } from "../project/project"
import { fn } from "../util/fn"
import { Config } from "@/config/config"
import { Log } from "../util/log"
export namespace Worktree {
  const log = Log.create({ service: "worktree" })

  export const CleanupMode = z.enum(["ask", "always", "never"])
  export type CleanupMode = z.infer<typeof CleanupMode>

  export const Info = z
    .object({
      path: z.string(),
      branch: z.string(),
      cleanup: CleanupMode.default("ask"),
    })
    .meta({
      ref: "WorktreeInfo",
    })
  export type Info = z.infer<typeof Info>

  /**
   * Generate the worktree path for a session.
   * Places worktree adjacent to main repo: ../reponame-session-{sessionId}
   */
  export function getPath(sessionID: string): string {
    const repoPath = Instance.worktree
    const repoName = path.basename(repoPath)
    const parentDir = path.dirname(repoPath)
    return path.join(parentDir, `${repoName}-session-${sessionID}`)
  }

  /**
   * Get the branch name for a session worktree.
   */
  export function getBranchName(sessionID: string): string {
    return `opencode/session-${sessionID}`
  }

  /**
   * Create a worktree with a dedicated branch for a session.
   * Creates branch opencode/session-{sessionID} at current HEAD.
   */
  export async function create(input: { sessionID: string; cleanup?: CleanupMode }): Promise<Info> {
    const worktreePath = getPath(input.sessionID)
    const branchName = getBranchName(input.sessionID)

    // Check if path already exists
    const pathExists = await fs
      .access(worktreePath)
      .then(() => true)
      .catch(() => false)

    if (pathExists) {
      // Try with a unique suffix
      const uniqueSuffix = Date.now().toString(36)
      const uniquePath = `${worktreePath}-${uniqueSuffix}`
      const uniqueBranch = `${branchName}-${uniqueSuffix}`
      log.warn("worktree path exists, using unique suffix", {
        original: worktreePath,
        unique: uniquePath,
      })
      return createAtPath(uniquePath, uniqueBranch, input.cleanup ?? "ask")
    }

    return createAtPath(worktreePath, branchName, input.cleanup ?? "ask")
  }

  /**
   * Check if a branch exists.
   */
  async function branchExists(branchName: string): Promise<boolean> {
    const result = await $`git show-ref --verify --quiet refs/heads/${branchName}`
      .cwd(Instance.worktree)
      .quiet()
      .nothrow()
    return result.exitCode === 0
  }

  async function createAtPath(worktreePath: string, branchName: string, cleanup: CleanupMode): Promise<Info> {
    log.info("creating worktree with branch", { path: worktreePath, branch: branchName })

    // Check if branch already exists (e.g., from failed cleanup)
    if (await branchExists(branchName)) {
      log.warn("branch already exists, deleting before creating worktree", { branch: branchName })
      await $`git branch -D ${branchName}`.cwd(Instance.worktree).quiet().nothrow()
    }

    // Create worktree with a new branch at current HEAD
    const result = await $`git worktree add -b ${branchName} ${worktreePath}`.cwd(Instance.worktree).quiet().nothrow()

    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString()
      log.error("failed to create worktree", {
        path: worktreePath,
        branch: branchName,
        exitCode: result.exitCode,
        stderr,
      })
      throw new WorktreeError({
        operation: "create",
        path: worktreePath,
        message: stderr || "Failed to create worktree",
      })
    }

    log.info("worktree created", { path: worktreePath, branch: branchName })

    return {
      path: worktreePath,
      branch: branchName,
      cleanup,
    }
  }

  /**
   * Remove a worktree and optionally its branch.
   */
  export async function remove(input: { path: string; branch?: string; deleteBranch?: boolean }): Promise<void> {
    const { path: worktreePath, branch, deleteBranch = true } = input
    log.info("removing worktree", { path: worktreePath, branch, deleteBranch })

    // First try git worktree remove
    const result = await $`git worktree remove ${worktreePath} --force`.cwd(Instance.worktree).quiet().nothrow()

    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString()
      log.warn("git worktree remove failed, trying manual cleanup", {
        path: worktreePath,
        stderr,
      })

      // Try manual cleanup
      try {
        await fs.rm(worktreePath, { recursive: true, force: true })
        // Also prune worktree references
        await $`git worktree prune`.cwd(Instance.worktree).quiet().nothrow()
        log.info("worktree manually removed", { path: worktreePath })
      } catch (err) {
        log.error("failed to remove worktree", { path: worktreePath, error: err })
        throw new WorktreeError({
          operation: "remove",
          path: worktreePath,
          message: "Failed to remove worktree",
        })
      }
    } else {
      log.info("worktree removed", { path: worktreePath })
    }

    // Delete the branch if requested
    if (branch && deleteBranch) {
      log.info("deleting branch", { branch })
      const branchResult = await $`git branch -D ${branch}`.cwd(Instance.worktree).quiet().nothrow()

      if (branchResult.exitCode !== 0) {
        log.warn("failed to delete branch", {
          branch,
          stderr: branchResult.stderr.toString(),
        })
        // Don't throw - worktree is already removed, branch cleanup is best-effort
      } else {
        log.info("branch deleted", { branch })
      }
    }
  }

  /**
   * Check if a worktree exists.
   */
  export async function exists(worktreePath: string): Promise<boolean> {
    const dirExists = await fs
      .access(worktreePath)
      .then(() => true)
      .catch(() => false)

    if (!dirExists) return false

    // Verify it's actually a git worktree
    const result = await $`git worktree list --porcelain`.cwd(Instance.worktree).quiet().nothrow()

    if (result.exitCode !== 0) return false

    const normalized = path.normalize(worktreePath)
    return result
      .text()
      .split("\n")
      .some((line) => {
        if (!line.startsWith("worktree ")) return false
        const listedPath = path.normalize(line.slice("worktree ".length))
        return listedPath === normalized
      })
  }

  /**
   * List all worktrees for the current repository.
   */
  export async function list(): Promise<string[]> {
    const result = await $`git worktree list --porcelain`.cwd(Instance.worktree).quiet().nothrow()

    if (result.exitCode !== 0) return []

    return result
      .text()
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
  }

  export class WorktreeError extends Error {
    constructor(
      public readonly info: {
        operation: "create" | "remove"
        path: string
        message: string
      },
    ) {
      super(`Worktree ${info.operation} failed: ${info.message}`)
      this.name = "WorktreeError"
    }
  }

  export const ManagedInfo = z
    .object({
      name: z.string(),
      branch: z.string(),
      directory: z.string(),
    })
    .meta({
      ref: "Worktree",
    })

  export type ManagedInfo = z.infer<typeof ManagedInfo>

  export const ManagedCreateInput = z
    .object({
      name: z.string().optional(),
      startCommand: z.string().optional(),
    })
    .meta({
      ref: "WorktreeCreateInput",
    })

  export type ManagedCreateInput = z.infer<typeof ManagedCreateInput>

  export const NotGitError = NamedError.create(
    "WorktreeNotGitError",
    z.object({
      message: z.string(),
    }),
  )

  export const NameGenerationFailedError = NamedError.create(
    "WorktreeNameGenerationFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const CreateFailedError = NamedError.create(
    "WorktreeCreateFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const StartCommandFailedError = NamedError.create(
    "WorktreeStartCommandFailedError",
    z.object({
      message: z.string(),
    }),
  )

  const ADJECTIVES = [
    "brave",
    "calm",
    "clever",
    "cosmic",
    "crisp",
    "curious",
    "eager",
    "gentle",
    "glowing",
    "happy",
    "hidden",
    "jolly",
    "kind",
    "lucky",
    "mighty",
    "misty",
    "neon",
    "nimble",
    "playful",
    "proud",
    "quick",
    "quiet",
    "shiny",
    "silent",
    "stellar",
    "sunny",
    "swift",
    "tidy",
    "witty",
  ] as const

  const NOUNS = [
    "cabin",
    "cactus",
    "canyon",
    "circuit",
    "comet",
    "eagle",
    "engine",
    "falcon",
    "forest",
    "garden",
    "harbor",
    "island",
    "knight",
    "lagoon",
    "meadow",
    "moon",
    "mountain",
    "nebula",
    "orchid",
    "otter",
    "panda",
    "pixel",
    "planet",
    "river",
    "rocket",
    "sailor",
    "squid",
    "star",
    "tiger",
    "wizard",
    "wolf",
  ] as const

  function pick<const T extends readonly string[]>(list: T) {
    return list[Math.floor(Math.random() * list.length)]
  }

  function slug(input: string) {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "")
  }

  function randomName() {
    return `${pick(ADJECTIVES)}-${pick(NOUNS)}`
  }

  async function directoryExists(target: string) {
    return fs
      .stat(target)
      .then(() => true)
      .catch(() => false)
  }

  function outputText(input: Uint8Array | undefined) {
    if (!input?.length) return ""
    return new TextDecoder().decode(input).trim()
  }

  function errorText(result: { stdout?: Uint8Array; stderr?: Uint8Array }) {
    return [outputText(result.stderr), outputText(result.stdout)].filter(Boolean).join("\n")
  }

  async function candidate(root: string, base?: string) {
    for (const attempt of Array.from({ length: 26 }, (_, i) => i)) {
      const name = base ? (attempt === 0 ? base : `${base}-${randomName()}`) : randomName()
      const branch = `opencode/${name}`
      const directory = path.join(root, name)

      if (await directoryExists(directory)) continue

      const ref = `refs/heads/${branch}`
      const branchCheck = await $`git show-ref --verify --quiet ${ref}`.quiet().nothrow().cwd(Instance.worktree)
      if (branchCheck.exitCode === 0) continue

      return ManagedInfo.parse({ name, branch, directory })
    }

    throw new NameGenerationFailedError({ message: "Failed to generate a unique worktree name" })
  }

  async function runStartCommand(directory: string, cmd: string) {
    if (process.platform === "win32") {
      return $`cmd /c ${cmd}`.nothrow().cwd(directory)
    }
    return $`bash -lc ${cmd}`.nothrow().cwd(directory)
  }

  export const createManaged = fn(ManagedCreateInput.optional(), async (input) => {
    if (Instance.project.vcs !== "git") {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const root = path.join(Global.Path.data, "worktree", Instance.project.id)
    await fs.mkdir(root, { recursive: true })

    const base = input?.name ? slug(input.name) : ""
    const info = await candidate(root, base || undefined)

    const created = await $`git worktree add -b ${info.branch} ${info.directory}`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
    if (created.exitCode !== 0) {
      throw new CreateFailedError({ message: errorText(created) || "Failed to create git worktree" })
    }

    const cmd = input?.startCommand?.trim()
    if (!cmd) return info

    const ran = await runStartCommand(info.directory, cmd)
    if (ran.exitCode !== 0) {
      throw new StartCommandFailedError({ message: errorText(ran) || "Worktree start command failed" })
    }

    return info
  })
}

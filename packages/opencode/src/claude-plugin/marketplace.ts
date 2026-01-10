import path from "path"
import { mkdir } from "fs/promises"
import { Config } from "@/config/config"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { ClaudePluginSchema } from "./schema"

export namespace ClaudePluginMarketplace {
  const log = Log.create({ service: "claude-plugin.marketplace" })

  // Default Claude Code marketplace URLs
  const DEFAULT_MARKETPLACES = [
    "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json",
  ]

  // Cache for marketplace entries with TTL
  interface MarketplaceCache {
    entries: ClaudePluginSchema.MarketplaceEntry[]
    fetchedAt: number
  }

  const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes
  let cache: MarketplaceCache | undefined

  /**
   * Get all marketplace URLs (default + configured)
   */
  async function getMarketplaceUrls(): Promise<string[]> {
    const config = await Config.get()
    const extra = (config as { extraKnownMarketplaces?: string[] }).extraKnownMarketplaces ?? []
    return [...DEFAULT_MARKETPLACES, ...extra]
  }

  /**
   * Fetch available plugins from all marketplaces
   */
  export async function list(forceRefresh = false): Promise<ClaudePluginSchema.MarketplaceEntry[]> {
    // Check cache
    if (!forceRefresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return cache.entries
    }

    const urls = await getMarketplaceUrls()
    const allEntries: ClaudePluginSchema.MarketplaceEntry[] = []
    const seen = new Set<string>()

    for (const url of urls) {
      const entries = await fetchMarketplace(url)
      for (const entry of entries) {
        if (!seen.has(entry.id)) {
          seen.add(entry.id)
          allEntries.push(entry)
        }
      }
    }

    // Update cache
    cache = {
      entries: allEntries,
      fetchedAt: Date.now(),
    }

    log.info("fetched marketplace entries", { count: allEntries.length })
    return allEntries
  }

  /**
   * Fetch a single marketplace URL
   */
  async function fetchMarketplace(url: string): Promise<ClaudePluginSchema.MarketplaceEntry[]> {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "OpenCode/1.0",
        },
      })

      if (!response.ok) {
        log.warn("failed to fetch marketplace", { url, status: response.status })
        return []
      }

      const data = await response.json()

      // Handle both array format and { plugins: [] } format
      const pluginsArray = Array.isArray(data) ? data : data.plugins
      if (!Array.isArray(pluginsArray)) {
        log.warn("invalid marketplace format", { url })
        return []
      }

      const entries: ClaudePluginSchema.MarketplaceEntry[] = []
      for (const item of pluginsArray) {
        const parsed = ClaudePluginSchema.MarketplaceEntry.safeParse(item)
        if (parsed.success) {
          entries.push(parsed.data)
        } else {
          log.warn("invalid marketplace entry", { url, issues: parsed.error.issues })
        }
      }

      return entries
    } catch (error) {
      log.warn("failed to fetch marketplace", {
        url,
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }

  /**
   * Get a specific plugin from the marketplace
   */
  export async function get(id: string): Promise<ClaudePluginSchema.MarketplaceEntry | undefined> {
    const entries = await list()
    return entries.find((e) => e.id === id || e.name === id)
  }

  /**
   * Search plugins by query
   */
  export async function search(query: string): Promise<ClaudePluginSchema.MarketplaceEntry[]> {
    const entries = await list()
    const lower = query.toLowerCase()

    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(lower) ||
        e.description?.toLowerCase().includes(lower) ||
        e.tags?.some((t) => t.toLowerCase().includes(lower)),
    )
  }

  // Base URL for official plugins repo
  const OFFICIAL_REPO_BASE = "https://github.com/anthropics/claude-plugins-official"

  /**
   * Resolve source to a downloadable URL
   */
  function resolveSource(source: ClaudePluginSchema.MarketplaceSource): string {
    if (typeof source === "string") {
      // Relative paths are relative to the official plugins repo
      if (source.startsWith("./")) {
        return `${OFFICIAL_REPO_BASE}/tree/main/${source.slice(2)}`
      }
      return source
    }
    // Object format: { source: "url", url: "..." }
    return source.url
  }

  /**
   * Download and install a plugin from the marketplace
   */
  export async function download(entry: ClaudePluginSchema.MarketplaceEntry, targetDir?: string): Promise<string> {
    const pluginDir = targetDir ?? path.join(Global.Path.data, "claude-plugins", entry.name)

    // Ensure the directory exists
    await mkdir(pluginDir, { recursive: true })

    const resolvedSource = resolveSource(entry.source)
    log.info("downloading plugin", { id: entry.id, source: resolvedSource, target: pluginDir })

    // Handle different source types
    if (resolvedSource.startsWith("git://") || resolvedSource.includes("github.com")) {
      // Git clone (for GitHub, clone the specific subdirectory using sparse checkout)
      await cloneGitRepo(resolvedSource, pluginDir, entry.source)
    } else if (resolvedSource.startsWith("http://") || resolvedSource.startsWith("https://")) {
      // Download archive (tar.gz or zip)
      await downloadArchive(resolvedSource, pluginDir)
    } else {
      throw new Error(`Unsupported source type: ${resolvedSource}`)
    }

    return pluginDir
  }

  async function cloneGitRepo(
    resolvedUrl: string,
    targetDir: string,
    originalSource: ClaudePluginSchema.MarketplaceSource,
  ): Promise<void> {
    // Check if this is a subdirectory of a repo (relative path like ./plugins/foo)
    if (typeof originalSource === "string" && originalSource.startsWith("./")) {
      // Use sparse checkout for subdirectory
      const subPath = originalSource.slice(2) // Remove "./"
      await sparseClone(OFFICIAL_REPO_BASE, subPath, targetDir)
      return
    }

    // Full repo clone
    let gitUrl = resolvedUrl
    if (resolvedUrl.includes("github.com") && !resolvedUrl.endsWith(".git")) {
      // Convert tree/main URLs back to clone URLs
      gitUrl = resolvedUrl.replace(/\/tree\/[^/]+\/.*$/, "").replace(/\/?$/, ".git")
    }

    const proc = Bun.spawn(["git", "clone", "--depth", "1", gitUrl, targetDir], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`Git clone failed: ${stderr}`)
    }
  }

  /**
   * Clone only a specific subdirectory from a repo using sparse checkout
   */
  async function sparseClone(repoUrl: string, subPath: string, targetDir: string): Promise<void> {
    const gitUrl = repoUrl.endsWith(".git") ? repoUrl : `${repoUrl}.git`

    // Initialize empty repo
    await runGit(["init", targetDir])

    // Add remote
    await runGit(["-C", targetDir, "remote", "add", "origin", gitUrl])

    // Enable sparse checkout
    await runGit(["-C", targetDir, "config", "core.sparseCheckout", "true"])

    // Set sparse checkout path
    const sparseFile = path.join(targetDir, ".git", "info", "sparse-checkout")
    await Bun.write(sparseFile, subPath + "\n")

    // Fetch and checkout
    await runGit(["-C", targetDir, "fetch", "--depth", "1", "origin", "main"])
    await runGit(["-C", targetDir, "checkout", "main"])

    // Move subdirectory contents to root
    const subDir = path.join(targetDir, subPath)
    const tempDir = targetDir + "-temp"

    // Move contents from subdir to temp, then back to target
    const { rename } = await import("fs/promises")
    await rename(subDir, tempDir)

    // Clean up target dir (except .git)
    const { readdir, rm } = await import("fs/promises")
    const entries = await readdir(targetDir)
    for (const entry of entries) {
      if (entry !== ".git") {
        await rm(path.join(targetDir, entry), { recursive: true, force: true })
      }
    }

    // Move temp contents back
    const tempEntries = await readdir(tempDir)
    for (const entry of tempEntries) {
      await rename(path.join(tempDir, entry), path.join(targetDir, entry))
    }
    await rm(tempDir, { recursive: true, force: true })
  }

  async function runGit(args: string[]): Promise<void> {
    const proc = Bun.spawn(["git", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`Git command failed: git ${args.join(" ")}: ${stderr}`)
    }
  }

  async function downloadArchive(url: string, targetDir: string): Promise<void> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.statusText}`)
    }

    const archivePath = path.join(Global.Path.cache, "plugin-download.tar.gz")
    await Bun.write(archivePath, response)

    // Extract the archive
    const proc = Bun.spawn(["tar", "-xzf", archivePath, "-C", targetDir, "--strip-components=1"], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`Failed to extract archive: ${stderr}`)
    }
  }

  /**
   * Clear the marketplace cache
   */
  export function clearCache(): void {
    cache = undefined
  }
}

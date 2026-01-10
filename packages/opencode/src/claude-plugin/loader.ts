import path from "path"
import { ConfigMarkdown } from "@/config/markdown"
import { Log } from "@/util/log"
import { ClaudePluginSchema } from "./schema"
import { ClaudePluginDiscovery } from "./discovery"

export namespace ClaudePluginLoader {
  const log = Log.create({ service: "claude-plugin.loader" })

  export interface LoadedCommand {
    pluginId: string
    pluginName: string
    name: string
    fullName: string
    description?: string
    template: string
    agent?: string
    model?: string
  }

  export interface LoadedAgent {
    pluginId: string
    pluginName: string
    name: string
    fullName: string
    description?: string
    prompt: string
    model?: string
    allowedTools?: string[]
  }

  export interface LoadedHook {
    pluginId: string
    event: ClaudePluginSchema.HookEvent
    matcher?: string
    type: "command" | "prompt" | "agent"
    command?: string
    prompt?: string
    timeout?: number
  }

  export interface LoadedMcp {
    pluginId: string
    pluginName: string
    name: string
    fullName: string
    config: {
      command?: string
      args?: string[]
      env?: Record<string, string>
      url?: string
      type?: "stdio" | "sse"
    }
  }

  export interface LoadedLsp {
    pluginId: string
    pluginName: string
    name: string
    fullName: string
    config: {
      command: string
      args?: string[]
      extensionToLanguage?: Record<string, string>
      env?: Record<string, string>
    }
  }

  export interface LoadedSkill {
    pluginId: string
    pluginName: string
    name: string
    fullName: string
    description: string
    prompt: string
    model?: string
    allowedTools?: string[]
    location: string
  }

  export interface LoadedPlugin {
    id: string
    name: string
    path: string
    manifest: ClaudePluginSchema.Manifest
    commands: LoadedCommand[]
    agents: LoadedAgent[]
    skills: LoadedSkill[]
    hooks: LoadedHook[]
    mcp: LoadedMcp[]
    lsp: LoadedLsp[]
  }

  const COMMAND_GLOB = new Bun.Glob("commands/**/*.md")
  const AGENT_GLOB = new Bun.Glob("agents/**/*.md")
  const SKILL_GLOB = new Bun.Glob("skills/**/SKILL.md")

  /**
   * Load a plugin from a directory, parsing all its components
   */
  export async function loadPlugin(pluginPath: string): Promise<LoadedPlugin | undefined> {
    const discovered = await ClaudePluginDiscovery.parsePlugin(pluginPath)
    if (!discovered) return undefined

    const pluginName = discovered.manifest.name
    const loaded: LoadedPlugin = {
      id: discovered.id,
      name: pluginName,
      path: pluginPath,
      manifest: discovered.manifest,
      commands: [],
      agents: [],
      skills: [],
      hooks: [],
      mcp: [],
      lsp: [],
    }

    // Load commands
    if (discovered.hasCommands) {
      for await (const match of COMMAND_GLOB.scan({
        cwd: pluginPath,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
      })) {
        const command = await loadCommand(match, discovered.id, pluginName)
        if (command) loaded.commands.push(command)
      }
    }

    // Load agents
    if (discovered.hasAgents) {
      for await (const match of AGENT_GLOB.scan({
        cwd: pluginPath,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
      })) {
        const agent = await loadAgent(match, discovered.id, pluginName)
        if (agent) loaded.agents.push(agent)
      }
    }

    // Load skills
    if (discovered.hasSkills) {
      for await (const match of SKILL_GLOB.scan({
        cwd: pluginPath,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
      })) {
        const skill = await loadSkill(match, discovered.id, pluginName)
        if (skill) loaded.skills.push(skill)
      }
    }

    // Load hooks
    if (discovered.hasHooks) {
      const hooks = await loadHooks(pluginPath, discovered.id)
      loaded.hooks.push(...hooks)
    }

    // Load MCP configs
    if (discovered.hasMcp) {
      const mcp = await loadMcp(pluginPath, discovered.id, pluginName)
      loaded.mcp.push(...mcp)
    }

    // Load LSP configs
    if (discovered.hasLsp) {
      const lsp = await loadLsp(pluginPath, discovered.id, pluginName)
      loaded.lsp.push(...lsp)
    }

    log.info("loaded plugin", {
      id: loaded.id,
      commands: loaded.commands.length,
      agents: loaded.agents.length,
      skills: loaded.skills.length,
      hooks: loaded.hooks.length,
      mcp: loaded.mcp.length,
      lsp: loaded.lsp.length,
    })

    return loaded
  }

  async function loadCommand(
    filePath: string,
    pluginId: string,
    pluginName: string,
  ): Promise<LoadedCommand | undefined> {
    const md = await ConfigMarkdown.parse(filePath).catch((e) => {
      log.warn("failed to parse command", { path: filePath, error: e.message })
      return undefined
    })
    if (!md) return undefined

    const parsed = ClaudePluginSchema.CommandFrontmatter.safeParse(md.data)
    const frontmatter = parsed.success ? parsed.data : {}

    const name = path.basename(filePath, ".md")
    const fullName = `${pluginName}:${name}`

    return {
      pluginId,
      pluginName,
      name,
      fullName,
      description: frontmatter.description,
      template: md.content.trim(),
      agent: frontmatter.agent,
      model: frontmatter.model,
    }
  }

  async function loadAgent(filePath: string, pluginId: string, pluginName: string): Promise<LoadedAgent | undefined> {
    const md = await ConfigMarkdown.parse(filePath).catch((e) => {
      log.warn("failed to parse agent", { path: filePath, error: e.message })
      return undefined
    })
    if (!md) return undefined

    const parsed = ClaudePluginSchema.AgentFrontmatter.safeParse(md.data)
    const frontmatter = parsed.success ? parsed.data : {}

    const name = frontmatter.name ?? path.basename(filePath, ".md")
    const fullName = `${pluginName}:${name}`

    // Parse allowed-tools as comma-separated list
    const allowedTools = frontmatter["allowed-tools"]
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean)

    return {
      pluginId,
      pluginName,
      name,
      fullName,
      description: frontmatter.description,
      prompt: md.content.trim(),
      model: frontmatter.model,
      allowedTools,
    }
  }

  async function loadSkill(filePath: string, pluginId: string, pluginName: string): Promise<LoadedSkill | undefined> {
    const md = await ConfigMarkdown.parse(filePath).catch((e) => {
      log.warn("failed to parse skill", { path: filePath, error: e.message })
      return undefined
    })
    if (!md) return undefined

    const parsed = ClaudePluginSchema.SkillFrontmatter.safeParse(md.data)
    if (!parsed.success) {
      log.warn("invalid skill frontmatter", { path: filePath, issues: parsed.error.issues })
      return undefined
    }

    const frontmatter = parsed.data
    const fullName = `${pluginName}:${frontmatter.name}`

    // Parse allowed-tools as comma-separated list
    const allowedTools = frontmatter["allowed-tools"]
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean)

    return {
      pluginId,
      pluginName,
      name: frontmatter.name,
      fullName,
      description: frontmatter.description,
      prompt: md.content.trim(),
      model: frontmatter.model,
      allowedTools,
      location: filePath,
    }
  }

  async function loadHooks(pluginPath: string, pluginId: string): Promise<LoadedHook[]> {
    const hooksPath = path.join(pluginPath, "hooks", "hooks.json")
    const hooksText = await Bun.file(hooksPath)
      .text()
      .catch(() => undefined)
    if (!hooksText) return []

    let hooksJson: unknown
    try {
      hooksJson = JSON.parse(hooksText)
    } catch {
      log.warn("invalid hooks json", { path: hooksPath })
      return []
    }

    const parsed = ClaudePluginSchema.HooksFile.safeParse(hooksJson)
    if (!parsed.success) {
      log.warn("invalid hooks file", { path: hooksPath, issues: parsed.error.issues })
      return []
    }

    const result: LoadedHook[] = []
    for (const [event, matchers] of Object.entries(parsed.data.hooks)) {
      for (const matcherConfig of matchers) {
        for (const hookDef of matcherConfig.hooks) {
          result.push({
            pluginId,
            event: event as ClaudePluginSchema.HookEvent,
            matcher: matcherConfig.matcher,
            type: hookDef.type,
            command: hookDef.command,
            prompt: hookDef.prompt,
            timeout: hookDef.timeout,
          })
        }
      }
    }

    return result
  }

  async function loadMcp(pluginPath: string, pluginId: string, pluginName: string): Promise<LoadedMcp[]> {
    const mcpPath = path.join(pluginPath, ".mcp.json")
    const mcpText = await Bun.file(mcpPath)
      .text()
      .catch(() => undefined)
    if (!mcpText) return []

    let mcpJson: unknown
    try {
      mcpJson = JSON.parse(mcpText)
    } catch {
      log.warn("invalid mcp json", { path: mcpPath })
      return []
    }

    const parsed = ClaudePluginSchema.McpConfig.safeParse(mcpJson)
    if (!parsed.success) {
      log.warn("invalid mcp config", { path: mcpPath, issues: parsed.error.issues })
      return []
    }

    const result: LoadedMcp[] = []
    for (const [name, config] of Object.entries(parsed.data)) {
      // Replace ${CLAUDE_PLUGIN_ROOT} with actual plugin path
      const resolvedConfig = {
        command: config.command?.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginPath),
        args: config.args?.map((arg) => arg.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginPath)),
        env: config.env
          ? Object.fromEntries(
              Object.entries(config.env).map(([k, v]) => [k, v.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginPath)]),
            )
          : undefined,
        url: config.url,
        type: config.type,
      }

      result.push({
        pluginId,
        pluginName,
        name,
        fullName: `${pluginName}:${name}`,
        config: resolvedConfig,
      })
    }

    return result
  }

  async function loadLsp(pluginPath: string, pluginId: string, pluginName: string): Promise<LoadedLsp[]> {
    const lspPath = path.join(pluginPath, ".lsp.json")
    const lspText = await Bun.file(lspPath)
      .text()
      .catch(() => undefined)
    if (!lspText) return []

    let lspJson: unknown
    try {
      lspJson = JSON.parse(lspText)
    } catch {
      log.warn("invalid lsp json", { path: lspPath })
      return []
    }

    const parsed = ClaudePluginSchema.LspConfig.safeParse(lspJson)
    if (!parsed.success) {
      log.warn("invalid lsp config", { path: lspPath, issues: parsed.error.issues })
      return []
    }

    const result: LoadedLsp[] = []
    for (const [name, config] of Object.entries(parsed.data)) {
      result.push({
        pluginId,
        pluginName,
        name,
        fullName: `${pluginName}:${name}`,
        config,
      })
    }

    return result
  }
}

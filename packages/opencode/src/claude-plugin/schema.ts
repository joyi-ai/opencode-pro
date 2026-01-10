import z from "zod"

export namespace ClaudePluginSchema {
  // Plugin manifest (.claude-plugin/plugin.json)
  export const Manifest = z
    .object({
      name: z.string(),
      version: z.string(),
      description: z.string().optional(),
      author: z
        .object({
          name: z.string(),
          email: z.string().optional(),
          url: z.string().optional(),
        })
        .or(z.string())
        .optional(),
      homepage: z.string().optional(),
      repository: z.string().optional(),
      license: z.string().optional(),
      keywords: z.array(z.string()).optional(),
      commands: z.array(z.string()).optional(),
      agents: z.string().optional(),
      skills: z.string().optional(),
      hooks: z.string().optional(),
      mcpServers: z.record(z.string(), z.any()).optional(),
      lspServers: z.string().optional(),
    })
    .meta({ ref: "ClaudePluginManifest" })

  export type Manifest = z.infer<typeof Manifest>

  // Hook event types
  export const HookEvent = z.enum([
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "UserPromptSubmit",
    "Notification",
    "Stop",
    "SubagentStop",
    "PreCompact",
    "SessionStart",
    "SessionEnd",
  ])

  export type HookEvent = z.infer<typeof HookEvent>

  // Permission modes for hooks
  export const PermissionMode = z.enum(["default", "plan", "bypassPermissions"])
  export type PermissionMode = z.infer<typeof PermissionMode>

  // Permission decision types
  export const PermissionDecision = z.enum(["allow", "deny", "ask"])
  export type PermissionDecision = z.infer<typeof PermissionDecision>

  // Base hook input fields (common to all hooks)
  const HookInputBase = z.object({
    session_id: z.string(),
    cwd: z.string(),
    permission_mode: PermissionMode.optional(),
    hook_source: z.literal("opencode-plugin"),
  })

  // PreToolUse input sent via stdin
  export const PreToolUseInput = HookInputBase.extend({
    hook_event_name: z.literal("PreToolUse"),
    transcript_path: z.string(),
    tool_name: z.string(), // PascalCase
    tool_input: z.record(z.string(), z.unknown()), // snake_case keys
    tool_use_id: z.string(),
  }).meta({ ref: "ClaudePluginPreToolUseInput" })
  export type PreToolUseInput = z.infer<typeof PreToolUseInput>

  // PostToolUse input sent via stdin
  export const PostToolUseInput = HookInputBase.extend({
    hook_event_name: z.literal("PostToolUse"),
    transcript_path: z.string(),
    tool_name: z.string(),
    tool_input: z.record(z.string(), z.unknown()),
    tool_result: z.unknown(),
    tool_use_id: z.string(),
  }).meta({ ref: "ClaudePluginPostToolUseInput" })
  export type PostToolUseInput = z.infer<typeof PostToolUseInput>

  // PostToolUseFailure input sent via stdin
  export const PostToolUseFailureInput = HookInputBase.extend({
    hook_event_name: z.literal("PostToolUseFailure"),
    transcript_path: z.string(),
    tool_name: z.string(),
    tool_input: z.record(z.string(), z.unknown()),
    error: z.string(),
    tool_use_id: z.string(),
  }).meta({ ref: "ClaudePluginPostToolUseFailureInput" })
  export type PostToolUseFailureInput = z.infer<typeof PostToolUseFailureInput>

  // UserPromptSubmit input sent via stdin
  export const UserPromptSubmitInput = HookInputBase.extend({
    hook_event_name: z.literal("UserPromptSubmit"),
    prompt: z.string(),
  }).meta({ ref: "ClaudePluginUserPromptSubmitInput" })
  export type UserPromptSubmitInput = z.infer<typeof UserPromptSubmitInput>

  // Stop input sent via stdin
  export const StopInput = HookInputBase.extend({
    hook_event_name: z.literal("Stop"),
    stop_hook_active: z.boolean(),
  }).meta({ ref: "ClaudePluginStopInput" })
  export type StopInput = z.infer<typeof StopInput>

  // PreCompact input sent via stdin
  export const PreCompactInput = HookInputBase.extend({
    hook_event_name: z.literal("PreCompact"),
  }).meta({ ref: "ClaudePluginPreCompactInput" })
  export type PreCompactInput = z.infer<typeof PreCompactInput>

  // Session input sent via stdin
  export const SessionInput = HookInputBase.extend({
    hook_event_name: z.enum(["SessionStart", "SessionEnd"]),
  }).meta({ ref: "ClaudePluginSessionInput" })
  export type SessionInput = z.infer<typeof SessionInput>

  // PermissionRequest input sent via stdin
  export const PermissionRequestInput = HookInputBase.extend({
    hook_event_name: z.literal("PermissionRequest"),
    permission: z.string(),
    patterns: z.array(z.string()),
  }).meta({ ref: "ClaudePluginPermissionRequestInput" })
  export type PermissionRequestInput = z.infer<typeof PermissionRequestInput>

  // Hook-specific output for PreToolUse
  export const PreToolUseHookOutput = z.object({
    hookEventName: z.literal("PreToolUse"),
    permissionDecision: PermissionDecision,
    permissionDecisionReason: z.string().optional(),
    updatedInput: z.record(z.string(), z.unknown()).optional(),
  })
  export type PreToolUseHookOutput = z.infer<typeof PreToolUseHookOutput>

  // Hook-specific output for PostToolUse
  export const PostToolUseHookOutput = z.object({
    hookEventName: z.literal("PostToolUse"),
    additionalContext: z.string().optional(),
  })
  export type PostToolUseHookOutput = z.infer<typeof PostToolUseHookOutput>

  // Hook-specific output for PreCompact
  export const PreCompactHookOutput = z.object({
    hookEventName: z.literal("PreCompact"),
    additionalContext: z.array(z.string()).optional(),
  })
  export type PreCompactHookOutput = z.infer<typeof PreCompactHookOutput>

  // Hook-specific output for Stop
  export const StopHookOutput = z.object({
    hookEventName: z.literal("Stop"),
    inject_prompt: z.string().optional(),
  })
  export type StopHookOutput = z.infer<typeof StopHookOutput>

  // Common hook output fields
  export const HookOutputBase = z.object({
    continue: z.boolean().optional(),
    stopReason: z.string().optional(),
    suppressOutput: z.boolean().optional(),
    systemMessage: z.string().optional(),
  })

  // General hook output format (parsed from stdout)
  export const HookOutput = HookOutputBase.extend({
    // Legacy decision fields (backward compat)
    decision: z.enum(["allow", "deny", "approve", "block", "ask"]).optional(),
    reason: z.string().optional(),
    // Hook-specific output (preferred)
    hookSpecificOutput: z
      .union([PreToolUseHookOutput, PostToolUseHookOutput, PreCompactHookOutput, StopHookOutput])
      .optional(),
  }).meta({ ref: "ClaudePluginHookOutput" })
  export type HookOutput = z.infer<typeof HookOutput>

  // Hook types
  export const HookType = z.enum(["command", "prompt", "agent"])

  // Single hook definition
  export const HookDefinition = z.object({
    type: HookType,
    command: z.string().optional(),
    prompt: z.string().optional(),
    timeout: z.number().int().positive().optional(),
  })

  // Hook matcher for filtering which tools trigger hooks
  export const HookMatcher = z.object({
    matcher: z.string().optional(),
    hooks: z.array(HookDefinition),
  })

  // Hooks file structure (hooks/hooks.json)
  export const HooksFile = z
    .object({
      hooks: z.record(HookEvent, z.array(HookMatcher)),
    })
    .meta({ ref: "ClaudePluginHooksFile" })

  export type HooksFile = z.infer<typeof HooksFile>

  // MCP server config
  export const McpServerConfig = z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
    type: z.enum(["stdio", "sse"]).optional(),
  })

  export const McpConfig = z.record(z.string(), McpServerConfig).meta({ ref: "ClaudePluginMcpConfig" })

  export type McpConfig = z.infer<typeof McpConfig>

  // LSP server config
  export const LspServerConfig = z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    extensionToLanguage: z.record(z.string(), z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })

  export const LspConfig = z.record(z.string(), LspServerConfig).meta({ ref: "ClaudePluginLspConfig" })

  export type LspConfig = z.infer<typeof LspConfig>

  // Command frontmatter
  export const CommandFrontmatter = z.object({
    description: z.string().optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
  })

  export type CommandFrontmatter = z.infer<typeof CommandFrontmatter>

  // Agent frontmatter
  export const AgentFrontmatter = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    model: z.string().optional(),
    tools: z.record(z.string(), z.boolean()).optional(),
    "allowed-tools": z.string().optional(),
  })

  export type AgentFrontmatter = z.infer<typeof AgentFrontmatter>

  // Skill frontmatter (skills/*/SKILL.md)
  export const SkillFrontmatter = z.object({
    name: z.string(),
    description: z.string(),
    "allowed-tools": z.string().optional(),
    model: z.string().optional(),
  })

  export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>

  // Plugin source
  export const PluginSource = z.enum(["local", "marketplace"])

  export type PluginSource = z.infer<typeof PluginSource>

  // Installed plugin info
  export const InstalledPlugin = z
    .object({
      id: z.string(),
      source: PluginSource,
      path: z.string(),
      enabled: z.boolean(),
      manifest: Manifest,
      installedAt: z.number(),
      updatedAt: z.number().optional(),
    })
    .meta({ ref: "ClaudePluginInstalled" })

  export type InstalledPlugin = z.infer<typeof InstalledPlugin>

  // Marketplace plugin source (can be string path or object with URL)
  export const MarketplaceSource = z.union([
    z.string(),
    z.object({
      source: z.literal("url"),
      url: z.string(),
    }),
  ])

  export type MarketplaceSource = z.infer<typeof MarketplaceSource>

  // Marketplace plugin entry (matches official claude-plugins-official format)
  export const MarketplaceEntry = z
    .object({
      // name is the primary identifier
      name: z.string(),
      // id is optional (defaults to name)
      id: z.string().optional(),
      version: z.string().optional(),
      description: z.string().optional(),
      author: z
        .object({
          name: z.string(),
          email: z.string().optional(),
        })
        .optional(),
      source: MarketplaceSource,
      homepage: z.string().optional(),
      repository: z.string().optional(),
      downloads: z.number().optional(),
      rating: z.number().optional(),
      tags: z.array(z.string()).optional(),
      category: z.string().optional(),
      strict: z.boolean().optional(),
      // Inline LSP servers (some plugins define these directly)
      lspServers: z
        .record(
          z.string(),
          LspServerConfig.extend({
            startupTimeout: z.number().optional(),
          }),
        )
        .optional(),
    })
    .transform((entry) => ({
      ...entry,
      // Ensure id is always set (use name if not provided)
      id: entry.id ?? entry.name,
    }))
    .meta({ ref: "ClaudePluginMarketplaceEntry" })

  export type MarketplaceEntry = z.infer<typeof MarketplaceEntry>

  // Marketplace registry format (matches official claude-plugins-official format)
  export const MarketplaceRegistry = z
    .object({
      $schema: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      owner: z
        .object({
          name: z.string(),
          email: z.string().optional(),
        })
        .optional(),
      version: z.string().optional(),
      plugins: z.array(MarketplaceEntry),
    })
    .meta({ ref: "ClaudePluginMarketplaceRegistry" })

  export type MarketplaceRegistry = z.infer<typeof MarketplaceRegistry>
}

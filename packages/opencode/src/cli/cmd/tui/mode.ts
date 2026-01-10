export type ModeId = "claude-code" | "codex" | "opencode" | "oh-my-opencode" | (string & {})

export type OhMyOpenCodeSettings = {
  sisyphusAgent?: {
    disabled?: boolean
    defaultBuilderEnabled?: boolean
    plannerEnabled?: boolean
    replacePlan?: boolean
  }
  disabledAgents?: string[]
  disabledHooks?: string[]
  claudeCode?: {
    mcp?: boolean
    commands?: boolean
    skills?: boolean
    agents?: boolean
    hooks?: boolean
    plugins?: boolean
  }
  autoUpdate?: boolean
}

export type ModeSettings = {
  ohMyOpenCode?: OhMyOpenCodeSettings
}

export type ModeDefinition = {
  id: ModeId
  name: string
  description?: string
  providerOverride?: string
  defaultAgent?: string
  allowedAgents?: string[]
  disabledAgents?: string[]
  requiresPlugins?: string[]
  settings?: ModeSettings
}

export const DEFAULT_MODE_ID: ModeId = "opencode"

export const OH_MY_OPENCODE_DEFAULT_SETTINGS: OhMyOpenCodeSettings = {
  sisyphusAgent: {
    disabled: false,
    defaultBuilderEnabled: false,
    plannerEnabled: true,
    replacePlan: true,
  },
  disabledAgents: [],
  disabledHooks: [],
  claudeCode: {
    mcp: true,
    commands: true,
    skills: true,
    agents: true,
    hooks: true,
    plugins: true,
  },
  autoUpdate: true,
}

export const BUILTIN_MODES: ModeDefinition[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Claude Code workflows with the claude-agent provider.",
    providerOverride: "claude-agent",
    defaultAgent: "build",
    allowedAgents: ["build", "plan"],
  },
  {
    id: "codex",
    name: "Codex",
    description: "Codex workflows powered by the Codex app-server.",
    providerOverride: "codex",
    defaultAgent: "build",
    allowedAgents: ["build", "plan"],
  },
  {
    id: "opencode",
    name: "OpenCode",
    description: "Standard OpenCode behavior with your preferred provider.",
    defaultAgent: "build",
    disabledAgents: [
      "Sisyphus",
      "OpenCode-Builder",
      "Planner-Sisyphus",
      "oracle",
      "librarian",
      "frontend-ui-ux-engineer",
      "document-writer",
      "multimodal-looker",
    ],
  },
  {
    id: "oh-my-opencode",
    name: "Oh My OpenCode",
    description: "Sisyphus orchestration with enhanced specialist agents.",
    defaultAgent: "Sisyphus",
    requiresPlugins: ["oh-my-opencode"],
    settings: {
      ohMyOpenCode: OH_MY_OPENCODE_DEFAULT_SETTINGS,
    },
  },
]

export function missingPlugins(
  target: ModeDefinition,
  input: {
    plugins: string[]
    agentNames: Set<string>
  },
) {
  const required = target.requiresPlugins ?? []
  if (required.length === 0) return []
  return required.filter((plugin) => {
    if (input.plugins.some((entry) => entry.includes(plugin))) return false
    if (plugin === "oh-my-opencode" && input.agentNames.has("Sisyphus")) return false
    return true
  })
}

export function isAvailable(
  target: ModeDefinition,
  input: {
    plugins: string[]
    agentNames: Set<string>
  },
) {
  return missingPlugins(target, input).length === 0
}

export function getAgentRules(target?: ModeDefinition) {
  const active = target ?? BUILTIN_MODES.find((x) => x.id === DEFAULT_MODE_ID)
  const allowed = active?.allowedAgents?.length ? new Set(active.allowedAgents) : undefined
  const disabled = new Set(active?.disabledAgents ?? [])
  const omo = active?.settings?.ohMyOpenCode

  if (active?.id === "oh-my-opencode" && omo) {
    const sisyphusDisabled = omo.sisyphusAgent?.disabled === true
    const replacePlan = omo.sisyphusAgent?.replacePlan ?? true

    if (!sisyphusDisabled) {
      disabled.add("build")
      if (replacePlan) disabled.add("plan")
    }

    for (const name of omo.disabledAgents ?? []) disabled.add(name)
    if (omo.sisyphusAgent?.disabled) disabled.add("Sisyphus")
    if (omo.sisyphusAgent?.defaultBuilderEnabled === false) disabled.add("OpenCode-Builder")
    if (omo.sisyphusAgent?.plannerEnabled === false) disabled.add("Planner-Sisyphus")
  }

  return { allowed, disabled }
}

export function isAgentAllowed(name: string, target?: ModeDefinition) {
  const rules = getAgentRules(target)
  if (rules.allowed && !rules.allowed.has(name)) return false
  if (rules.disabled.has(name)) return false
  return true
}

export function filterAgents<T extends { name: string }>(agents: T[], target?: ModeDefinition) {
  return agents.filter((agent) => isAgentAllowed(agent.name, target))
}

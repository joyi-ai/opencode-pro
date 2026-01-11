import { Component, For, Show, createMemo, createEffect, on } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { useLocal } from "@/context/local"
import { useSync } from "@/context/sync"
import { useProviders } from "@/hooks/use-providers"
import { BUILTIN_MODES } from "@/modes/definitions"
import {
  OH_MY_OPENCODE_AGENT_OPTIONS,
  OH_MY_OPENCODE_DEFAULT_SETTINGS,
  OH_MY_OPENCODE_HOOK_OPTIONS,
} from "@/modes/oh-my-opencode"
import type { ModeDefinition, OhMyOpenCodeSettings } from "@/modes/types"

type ProviderOption = {
  id: string
  label: string
  value: string | null
}

type AgentOption = {
  id: string
  label: string
  value: string | null
  description?: string
}

type ToggleTokenProps = {
  label: string
  enabled: boolean
  onToggle: (next: boolean) => void
}

const ToggleToken: Component<ToggleTokenProps> = (props) => (
  <button
    type="button"
    class="px-2 py-1 rounded text-11-regular transition-colors"
    classList={{
      "bg-surface-info-base/20 text-text-info-base": props.enabled,
      "text-text-subtle hover:text-text-base": !props.enabled,
    }}
    onClick={() => props.onToggle(!props.enabled)}
  >
    {props.label}
  </button>
)

const buildOhMySettings = (input?: OhMyOpenCodeSettings): OhMyOpenCodeSettings => {
  const defaultSettings = OH_MY_OPENCODE_DEFAULT_SETTINGS
  return {
    sisyphusAgent: {
      ...defaultSettings.sisyphusAgent,
      ...input?.sisyphusAgent,
    },
    disabledAgents: [...(input?.disabledAgents ?? defaultSettings.disabledAgents ?? [])],
    disabledHooks: [...(input?.disabledHooks ?? defaultSettings.disabledHooks ?? [])],
    claudeCode: {
      ...defaultSettings.claudeCode,
      ...input?.claudeCode,
    },
    autoUpdate: input?.autoUpdate ?? defaultSettings.autoUpdate,
  }
}

export const ModeSettingsPanel: Component<{
  mode: ModeDefinition
  onClose?: () => void
  showCancel?: boolean
}> = (props) => {
  const local = useLocal()
  const sync = useSync()
  const providers = useProviders()

  const baseMode = createMemo(
    () =>
      BUILTIN_MODES.find((item) => item.id === props.mode.id) ??
      local.mode.custom.list().find((item) => item.id === props.mode.id) ??
      props.mode,
  )

  const buildStore = () => {
    const override = local.mode.getOverride(props.mode.id)
    const initialProviderOverride = override?.providerOverride === undefined ? null : override.providerOverride
    const initialDefaultAgent = override?.defaultAgent === undefined ? null : override.defaultAgent
    return {
      name: props.mode.name,
      description: props.mode.description ?? "",
      providerOverride: initialProviderOverride as string | null | undefined,
      defaultAgent: initialDefaultAgent as string | null | undefined,
      settings:
        props.mode.id === "oh-my-opencode"
          ? {
              ohMyOpenCode: buildOhMySettings(props.mode.settings?.ohMyOpenCode),
            }
          : undefined,
    }
  }

  const [store, setStore] = createStore(buildStore())

  createEffect(
    on(
      () => props.mode.id,
      () => {
        setStore(buildStore())
      },
    ),
  )

  const providerOptions = createMemo<ProviderOption[]>(() => [
    { id: "none", label: "No override", value: null },
    ...providers.connected().map((provider) => ({
      id: provider.id,
      label: provider.name,
      value: provider.id,
    })),
  ])

  const currentProviderOption = createMemo(
    () => providerOptions().find((option) => option.value === store.providerOverride) ?? providerOptions()[0],
  )

  const modePreview = createMemo(() => ({
    ...props.mode,
    settings: store.settings ?? props.mode.settings,
  }))

  const agentOptions = createMemo(() =>
    local.mode.filterAgents(
      sync.data.agent.filter((agent) => agent.mode !== "subagent" && !agent.hidden),
      modePreview(),
    ),
  )

  const defaultAgentOptions = createMemo<AgentOption[]>(() => {
    const defaultLabel = baseMode().defaultAgent ? `Mode default (${baseMode().defaultAgent})` : "Mode default"
    return [
      { id: "mode-default", label: defaultLabel, value: null },
      ...agentOptions().map((agent) => ({
        id: agent.name,
        label: agent.name,
        value: agent.name,
        description: agent.description,
      })),
    ]
  })

  const currentAgentOption = createMemo(
    () => defaultAgentOptions().find((option) => option.value === store.defaultAgent) ?? defaultAgentOptions()[0],
  )

  const ohMySettings = () => store.settings?.ohMyOpenCode
  const isOhMyMode = () => props.mode.id === "oh-my-opencode"
  const isClaudeCode = () => props.mode.id === "claude-code"
  const isCodexMode = () => props.mode.id === "codex"
  const isLockedProvider = () => isClaudeCode() || isCodexMode()
  const hasOverrides = createMemo(() => !!local.mode.getOverride(props.mode.id))

  const toggleListValue = (key: "disabledAgents" | "disabledHooks", value: string, enabled: boolean) => {
    setStore("settings", "ohMyOpenCode", key, (items) => {
      const current = items ?? []
      if (enabled) return current.filter((item) => item !== value)
      if (current.includes(value)) return current
      return [...current, value]
    })
  }

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault()
    local.mode.setOverride(props.mode.id, {
      name: store.name.trim() || baseMode().name,
      description: store.description.trim() || undefined,
      providerOverride: isLockedProvider() ? props.mode.providerOverride : (store.providerOverride ?? undefined),
      defaultAgent: store.defaultAgent ?? undefined,
      settings: store.settings,
    })
    props.onClose?.()
  }

  const handleReset = () => {
    local.mode.resetOverride(props.mode.id)
    props.onClose?.()
  }

  return (
    <form onSubmit={handleSubmit} class="flex flex-col gap-6">
      <div class="flex flex-col gap-4">
        <TextField
          autofocus
          type="text"
          label="Display name"
          value={store.name}
          onChange={(value) => setStore("name", value)}
        />
        <TextField
          multiline
          label="Description"
          value={store.description}
          onChange={(value) => setStore("description", value)}
          placeholder="Describe when to use this mode"
        />
        <div class="flex flex-col gap-2">
          <label class="text-12-medium text-text-weak">Default provider</label>
          <Show
            when={!isLockedProvider()}
            fallback={
              <div class="text-13-regular text-text-strong px-2 py-1.5 rounded-md border border-border-base bg-surface-raised-base">
                {props.mode.providerOverride ?? "claude-agent"}
              </div>
            }
          >
            <Select
              options={providerOptions()}
              current={currentProviderOption()}
              value={(option) => option.id}
              label={(option) => option.label}
              onSelect={(option) => setStore("providerOverride", option?.value ?? null)}
              variant="ghost"
              class="justify-between"
            />
          </Show>
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-12-medium text-text-weak">Default agent</label>
          <Select
            options={defaultAgentOptions()}
            current={currentAgentOption()}
            value={(option) => option.id}
            label={(option) => option.label}
            onSelect={(option) => setStore("defaultAgent", option?.value ?? null)}
            variant="ghost"
            class="justify-between"
          />
        </div>
      </div>

      <Show when={isOhMyMode()}>
        <div class="border-t border-border-base pt-4 flex flex-col gap-4">
          <div class="text-12-medium text-text-strong">Oh My OpenCode</div>
          <div class="flex flex-col gap-3">
            <Switch
              checked={!ohMySettings()?.sisyphusAgent?.disabled}
              onChange={(checked) => setStore("settings", "ohMyOpenCode", "sisyphusAgent", "disabled", !checked)}
            >
              Enable Sisyphus orchestrator
            </Switch>
            <div class="grid grid-cols-2 gap-2">
              <Switch
                checked={!!ohMySettings()?.sisyphusAgent?.defaultBuilderEnabled}
                onChange={(checked) =>
                  setStore("settings", "ohMyOpenCode", "sisyphusAgent", "defaultBuilderEnabled", checked)
                }
              >
                OpenCode-Builder
              </Switch>
              <Switch
                checked={ohMySettings()?.sisyphusAgent?.plannerEnabled ?? true}
                onChange={(checked) =>
                  setStore("settings", "ohMyOpenCode", "sisyphusAgent", "plannerEnabled", checked)
                }
              >
                Planner-Sisyphus
              </Switch>
              <Switch
                checked={ohMySettings()?.sisyphusAgent?.replacePlan ?? true}
                onChange={(checked) => setStore("settings", "ohMyOpenCode", "sisyphusAgent", "replacePlan", checked)}
              >
                Replace default plan
              </Switch>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <div class="text-12-medium text-text-weak">Agents</div>
            <div class="flex flex-wrap gap-2">
              <For each={OH_MY_OPENCODE_AGENT_OPTIONS.filter((name) => name !== "Sisyphus")}>
                {(agent) => (
                  <ToggleToken
                    label={agent}
                    enabled={!ohMySettings()?.disabledAgents?.includes(agent)}
                    onToggle={(enabled) => toggleListValue("disabledAgents", agent, enabled)}
                  />
                )}
              </For>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <div class="text-12-medium text-text-weak">Hooks</div>
            <div class="flex flex-wrap gap-2 max-h-40 overflow-y-auto pr-1">
              <For each={OH_MY_OPENCODE_HOOK_OPTIONS}>
                {(hook) => (
                  <ToggleToken
                    label={hook}
                    enabled={!ohMySettings()?.disabledHooks?.includes(hook)}
                    onToggle={(enabled) => toggleListValue("disabledHooks", hook, enabled)}
                  />
                )}
              </For>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <div class="text-12-medium text-text-weak">Claude Code compatibility</div>
            <div class="grid grid-cols-2 gap-2">
              <Switch
                checked={ohMySettings()?.claudeCode?.mcp ?? true}
                onChange={(checked) => setStore("settings", "ohMyOpenCode", "claudeCode", "mcp", checked)}
              >
                MCP
              </Switch>
              <Switch
                checked={ohMySettings()?.claudeCode?.commands ?? true}
                onChange={(checked) => setStore("settings", "ohMyOpenCode", "claudeCode", "commands", checked)}
              >
                Commands
              </Switch>
              <Switch
                checked={ohMySettings()?.claudeCode?.skills ?? true}
                onChange={(checked) => setStore("settings", "ohMyOpenCode", "claudeCode", "skills", checked)}
              >
                Skills
              </Switch>
              <Switch
                checked={ohMySettings()?.claudeCode?.agents ?? true}
                onChange={(checked) => setStore("settings", "ohMyOpenCode", "claudeCode", "agents", checked)}
              >
                Agents
              </Switch>
              <Switch
                checked={ohMySettings()?.claudeCode?.hooks ?? true}
                onChange={(checked) => setStore("settings", "ohMyOpenCode", "claudeCode", "hooks", checked)}
              >
                Hooks
              </Switch>
              <Switch
                checked={ohMySettings()?.claudeCode?.plugins ?? true}
                onChange={(checked) => setStore("settings", "ohMyOpenCode", "claudeCode", "plugins", checked)}
              >
                Plugins
              </Switch>
            </div>
          </div>

          <Switch
            checked={ohMySettings()?.autoUpdate ?? true}
            onChange={(checked) => setStore("settings", "ohMyOpenCode", "autoUpdate", checked)}
          >
            Auto update
          </Switch>
        </div>
      </Show>

      <div class="flex items-center justify-between">
        <Button type="button" variant="ghost" disabled={!hasOverrides()} onClick={handleReset}>
          Reset to defaults
        </Button>
        <div class="flex items-center gap-2">
          <Show when={props.showCancel}>
            <Button type="button" variant="ghost" onClick={() => props.onClose?.()}>
              Cancel
            </Button>
          </Show>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </div>
    </form>
  )
}

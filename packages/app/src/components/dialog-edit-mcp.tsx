import { Component, Show, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import type { Config } from "@opencode-ai/sdk/v2/client"

type McpEntry = NonNullable<Config["mcp"]>[string]
export type McpConfigured = Extract<McpEntry, { type: "local" | "remote" }>

export function isMcpConfigured(entry: McpEntry | undefined): entry is McpConfigured {
  if (!entry) return false
  if (typeof entry !== "object") return false
  if (!("type" in entry)) return false
  return true
}

type JsonResult = { ok: true; value?: Record<string, string> } | { ok: false }

export const DialogEditMcp: Component<{ name?: string; entry?: McpConfigured }> = (props) => {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const [saving, setSaving] = createSignal(false)

  const entry = props.entry
  const isLocalEntry = entry?.type === "local"
  const isRemoteEntry = entry?.type === "remote"
  const oauthConfig = isRemoteEntry && typeof entry?.oauth === "object" ? entry.oauth : undefined

  const [store, setStore] = createStore({
    name: props.name ?? "",
    type: isLocalEntry ? "local" : "remote",
    command: isLocalEntry ? (entry?.command?.[0] ?? "") : "",
    args: isLocalEntry ? (entry?.command?.slice(1).join(" ") ?? "") : "",
    env: isLocalEntry && entry?.environment ? JSON.stringify(entry.environment, null, 2) : "",
    url: isRemoteEntry ? (entry?.url ?? "") : "",
    headers: isRemoteEntry && entry?.headers ? JSON.stringify(entry.headers, null, 2) : "",
    oauthDisabled: isRemoteEntry && entry?.oauth === false,
    oauthClientId: oauthConfig?.clientId ?? "",
    oauthClientSecret: oauthConfig?.clientSecret ?? "",
    oauthScope: oauthConfig?.scope ?? "",
    enabled: entry?.enabled !== false,
  })

  const typeOptions = [
    { id: "local", label: "Local (command)" },
    { id: "remote", label: "Remote (URL)" },
  ]
  const currentType = createMemo(() => typeOptions.find((option) => option.id === store.type) ?? typeOptions[0])

  const parseJsonRecord = async (value: string, label: string): Promise<JsonResult> => {
    const trimmed = value.trim()
    if (!trimmed) return { ok: true }
    const parsed = await Promise.resolve()
      .then(() => JSON.parse(trimmed) as unknown)
      .catch(() => undefined)
    if (!parsed) {
      showToast({
        variant: "error",
        title: `Invalid ${label}`,
        description: `${label} must be valid JSON.`,
      })
      return { ok: false }
    }
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      showToast({
        variant: "error",
        title: `Invalid ${label}`,
        description: `${label} must be a JSON object.`,
      })
      return { ok: false }
    }
    const entries = Object.entries(parsed)
    const allStrings = entries.every(([, entryValue]) => typeof entryValue === "string")
    if (!allStrings) {
      showToast({
        variant: "error",
        title: `Invalid ${label}`,
        description: `${label} values must be strings.`,
      })
      return { ok: false }
    }
    return { ok: true, value: Object.fromEntries(entries) as Record<string, string> }
  }

  const saveConfig = async (name: string, next: McpConfigured) => {
    const existing = sync.data.config.mcp ?? {}
    const result: Record<string, McpEntry> = { ...existing }
    if (props.name && props.name !== name) {
      delete result[props.name]
    }
    result[name] = next

    const error = await sdk.client.config
      .update({ config: { mcp: result } })
      .then(() => undefined)
      .catch((err) => err as Error)
    if (error) {
      showToast({
        variant: "error",
        title: "Failed to save MCP",
        description: error.message,
      })
      setSaving(false)
      return
    }

    sync.set("config", "mcp", result)
    showToast({
      variant: "success",
      title: "MCP saved",
      description: "Changes sync to OpenCode, Claude Code, and Codex.",
    })
    setSaving(false)
    dialog.close()
  }

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (saving()) return
    setSaving(true)

    const name = store.name.trim()
    if (!name) {
      showToast({
        variant: "error",
        title: "Name required",
        description: "Enter a name for this MCP server.",
      })
      setSaving(false)
      return
    }

    if (store.type === "local") {
      const command = store.command.trim()
      if (!command) {
        showToast({
          variant: "error",
          title: "Command required",
          description: "Enter the command to run the MCP server.",
        })
        setSaving(false)
        return
      }
      const args = store.args.trim().length > 0 ? store.args.trim().split(/\s+/).filter(Boolean) : []
      const envResult = await parseJsonRecord(store.env, "Environment")
      if (!envResult.ok) {
        setSaving(false)
        return
      }
      const next: McpConfigured = {
        type: "local",
        command: [command, ...args],
        enabled: store.enabled,
        ...(envResult.value ? { environment: envResult.value } : {}),
      }
      await saveConfig(name, next)
      return
    }

    const url = store.url.trim()
    if (!url) {
      showToast({
        variant: "error",
        title: "URL required",
        description: "Enter the MCP server URL.",
      })
      setSaving(false)
      return
    }
    if (!URL.canParse(url)) {
      showToast({
        variant: "error",
        title: "Invalid URL",
        description: "Enter a valid MCP server URL.",
      })
      setSaving(false)
      return
    }

    const headersResult = await parseJsonRecord(store.headers, "Headers")
    if (!headersResult.ok) {
      setSaving(false)
      return
    }

    const oauthFields = {
      clientId: store.oauthClientId.trim() || undefined,
      clientSecret: store.oauthClientSecret.trim() || undefined,
      scope: store.oauthScope.trim() || undefined,
    }
    const hasOauth = !!(oauthFields.clientId || oauthFields.clientSecret || oauthFields.scope)
    const oauth = store.oauthDisabled ? { oauth: false as const } : hasOauth ? { oauth: oauthFields } : {}

    const next: McpConfigured = {
      type: "remote",
      url,
      enabled: store.enabled,
      ...(headersResult.value ? { headers: headersResult.value } : {}),
      ...oauth,
    }
    await saveConfig(name, next)
  }

  return (
    <Dialog
      title={props.name ? "Edit MCP" : "Add MCP"}
      description="Configure MCP servers for OpenCode, Claude Code, and Codex."
    >
      <form onSubmit={handleSubmit} class="flex flex-col gap-4 px-2.5 pb-3">
        <TextField
          autofocus
          label="Name"
          value={store.name}
          onChange={(value) => setStore("name", value)}
          placeholder="e.g., playwright"
        />
        <div class="flex flex-col gap-2">
          <label class="text-12-medium text-text-weak">Type</label>
          <Select
            options={typeOptions}
            current={currentType()}
            value={(option) => option.id}
            label={(option) => option.label}
            onSelect={(option) => setStore("type", option?.id ?? "remote")}
            variant="ghost"
            class="justify-between"
          />
        </div>
        <Show when={store.type === "local"}>
          <div class="flex flex-col gap-3">
            <TextField
              label="Command"
              value={store.command}
              onChange={(value) => setStore("command", value)}
              placeholder="npx"
            />
            <TextField
              label="Args (space separated)"
              value={store.args}
              onChange={(value) => setStore("args", value)}
              placeholder="@playwright/mcp@latest"
            />
            <TextField
              multiline
              label="Environment (JSON)"
              value={store.env}
              onChange={(value) => setStore("env", value)}
              placeholder='{"FOO":"bar"}'
              class="min-h-[88px]"
            />
          </div>
        </Show>
        <Show when={store.type === "remote"}>
          <div class="flex flex-col gap-3">
            <TextField
              label="URL"
              value={store.url}
              onChange={(value) => setStore("url", value)}
              placeholder="https://example.com/mcp"
            />
            <TextField
              multiline
              label="Headers (JSON)"
              value={store.headers}
              onChange={(value) => setStore("headers", value)}
              placeholder='{"Authorization":"Bearer ..."}'
              class="min-h-[88px]"
            />
            <Switch checked={!store.oauthDisabled} onChange={(value) => setStore("oauthDisabled", !value)}>
              Enable OAuth
            </Switch>
            <Show when={!store.oauthDisabled}>
              <div class="flex flex-col gap-3">
                <TextField
                  label="OAuth client ID"
                  value={store.oauthClientId}
                  onChange={(value) => setStore("oauthClientId", value)}
                />
                <TextField
                  label="OAuth client secret"
                  value={store.oauthClientSecret}
                  onChange={(value) => setStore("oauthClientSecret", value)}
                />
                <TextField
                  label="OAuth scope"
                  value={store.oauthScope}
                  onChange={(value) => setStore("oauthScope", value)}
                />
              </div>
            </Show>
          </div>
        </Show>
        <Switch checked={store.enabled} onChange={(value) => setStore("enabled", value)}>
          Auto-connect on start
        </Switch>
        <div class="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving()}>
            {saving() ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

export const DialogRemoveMcp: Component<{ name: string }> = (props) => {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const [saving, setSaving] = createSignal(false)

  const remove = async () => {
    if (saving()) return
    setSaving(true)
    const existing = sync.data.config.mcp ?? {}
    const result: Record<string, McpEntry> = { ...existing }
    delete result[props.name]

    const error = await sdk.client.config
      .update({ config: { mcp: result } })
      .then(() => undefined)
      .catch((err) => err as Error)
    if (error) {
      showToast({
        variant: "error",
        title: "Failed to remove MCP",
        description: error.message,
      })
      setSaving(false)
      return
    }

    sync.set("config", "mcp", result)
    showToast({
      variant: "success",
      title: "MCP removed",
    })
    setSaving(false)
    dialog.close()
  }

  return (
    <Dialog title="Remove MCP" description={`Remove "${props.name}" from your configuration?`}>
      <div class="flex items-center justify-end gap-2 px-2.5 pb-3">
        <Button type="button" variant="ghost" onClick={() => dialog.close()}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={remove} disabled={saving()}>
          {saving() ? "Removing..." : "Remove"}
        </Button>
      </div>
    </Dialog>
  )
}

import { Component, createMemo, createSignal, Show } from "solid-js"
import { SyncProvider, useSync } from "@/context/sync"
import { SDKProvider, useSDK } from "@/context/sdk"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Switch } from "@opencode-ai/ui/switch"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { showToast } from "@opencode-ai/ui/toast"
import type { Config } from "@opencode-ai/sdk/v2/client"
import { DialogEditMcp, DialogRemoveMcp, isMcpConfigured, type McpConfigured } from "./dialog-edit-mcp"

export const McpSettingsPanel: Component = () => {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const [loading, setLoading] = createSignal<string | null>(null)

  type McpEntry = NonNullable<Config["mcp"]>[string]
  const configs = createMemo(() => sync.data.config.mcp ?? {})
  const items = createMemo(() =>
    Object.entries(configs())
      .filter((entry): entry is [string, McpConfigured] => isMcpConfigured(entry[1] as McpEntry))
      .map(([name, entry]) => {
        const state = sync.data.mcp?.[name]
        return {
          name,
          entry,
          status: state?.status ?? "unknown",
          state,
          type: entry.type,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const toggle = async (name: string) => {
    if (loading()) return
    setLoading(name)
    const status = sync.data.mcp[name]
    const error =
      status?.status === "connected"
        ? await sdk.client.mcp
            .disconnect({ name })
            .then(() => undefined)
            .catch((err) => err as Error)
        : await sdk.client.mcp
            .connect({ name })
            .then(() => undefined)
            .catch((err) => err as Error)
    if (error) {
      showToast({
        variant: "error",
        title: "MCP update failed",
        description: error.message,
      })
      setLoading(null)
      return
    }
    const result = await sdk.client.mcp.status().catch(() => undefined)
    if (result?.data) sync.set("mcp", result.data)
    setLoading(null)
  }

  const authenticate = async (name: string) => {
    if (loading()) return
    setLoading(name)
    const error = await sdk.client.mcp.auth
      .authenticate({ name })
      .then(() => undefined)
      .catch((err) => err as Error)
    if (error) {
      showToast({
        variant: "error",
        title: "Authentication failed",
        description: error.message,
      })
      setLoading(null)
      return
    }
    const result = await sdk.client.mcp.status().catch(() => undefined)
    if (result?.data) sync.set("mcp", result.data)
    setLoading(null)
  }

  const enabledCount = createMemo(() => items().filter((i) => i.status === "connected").length)
  const totalCount = createMemo(() => items().length)
  const showEdit = (name?: string, entry?: McpConfigured) => {
    dialog.show(() => (
      <SDKProvider directory={sdk.directory}>
        <SyncProvider>
          <DialogEditMcp name={name} entry={entry} />
        </SyncProvider>
      </SDKProvider>
    ))
  }
  const showRemove = (name: string) => {
    dialog.show(() => (
      <SDKProvider directory={sdk.directory}>
        <SyncProvider>
          <DialogRemoveMcp name={name} />
        </SyncProvider>
      </SDKProvider>
    ))
  }

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between px-2.5 pb-2">
        <div class="text-12-regular text-text-weak">
          {enabledCount()} of {totalCount()} enabled - Synced to OpenCode, Claude Code, and Codex
        </div>
        <Button size="small" icon="plus" onClick={() => showEdit()}>
          Add MCP
        </Button>
      </div>
      <List
        search={{ placeholder: "Search", autofocus: true }}
        emptyMessage="No MCPs configured"
        key={(x) => x?.name ?? ""}
        items={items()}
        filterKeys={["name", "status", "type"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        onSelect={(x) => {
          if (x) toggle(x.name)
        }}
      >
        {(i) => {
          const mcpStatus = () => i.state
          const status = () => mcpStatus()?.status
          const error = () => {
            const s = mcpStatus()
            return s?.status === "failed" || s?.status === "needs_client_registration" ? s.error : undefined
          }
          const enabled = () => status() === "connected"
          return (
            <div class="w-full flex items-center justify-between gap-x-3">
              <div class="flex flex-col gap-0.5 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="truncate">{i.name}</span>
                  <span class="text-11-regular text-text-weaker">{i.entry.type}</span>
                  <Show when={status() === "connected"}>
                    <span class="text-11-regular text-text-weaker">connected</span>
                  </Show>
                  <Show when={status() === "failed"}>
                    <span class="text-11-regular text-text-weaker">failed</span>
                  </Show>
                  <Show when={status() === "needs_auth"}>
                    <span class="text-11-regular text-text-weaker">needs auth</span>
                  </Show>
                  <Show when={status() === "needs_client_registration"}>
                    <span class="text-11-regular text-text-weaker">needs client registration</span>
                  </Show>
                  <Show when={status() === "disabled"}>
                    <span class="text-11-regular text-text-weaker">disabled</span>
                  </Show>
                  <Show when={loading() === i.name}>
                    <span class="text-11-regular text-text-weak">...</span>
                  </Show>
                </div>
                <Show when={error()}>
                  <span class="text-11-regular text-text-weaker truncate">{error()}</span>
                </Show>
              </div>
              <div class="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <Show when={status() === "needs_auth"}>
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => authenticate(i.name)}
                    disabled={loading() === i.name}
                  >
                    Auth
                  </Button>
                </Show>
                <IconButton icon="edit-small-2" variant="ghost" onClick={() => showEdit(i.name, i.entry)} />
                <IconButton icon="circle-x" variant="ghost" onClick={() => showRemove(i.name)} />
                <Switch checked={enabled()} disabled={loading() === i.name} onChange={() => toggle(i.name)} />
              </div>
            </div>
          )
        }}
      </List>
    </div>
  )
}

export const DialogSelectMcp: Component = () => {
  return (
    <Dialog title="MCPs" description="Manage MCP servers for this project.">
      <McpSettingsPanel />
    </Dialog>
  )
}

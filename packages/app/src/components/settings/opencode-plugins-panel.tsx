import { Show, createMemo, createSignal, type Component } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { List } from "@opencode-ai/ui/list"
import { Switch } from "@opencode-ai/ui/switch"
import { Tag } from "@opencode-ai/ui/tag"
import { showToast } from "@opencode-ai/ui/toast"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

type OpenCodePluginItem = {
  spec: string
  name: string
  canonical: string
  source: string
  enabled: boolean
  location?: string
}

function baseName(input: string): string {
  const parts = input.split("/").filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : input
}

function stripExtension(input: string): string {
  const index = input.lastIndexOf(".")
  if (index <= 0) return input
  return input.slice(0, index)
}

function pluginCanonical(spec: string): string {
  if (spec.startsWith("file://")) {
    try {
      const pathname = new URL(spec).pathname
      return stripExtension(baseName(pathname))
    } catch {
      return spec
    }
  }
  const lastAt = spec.lastIndexOf("@")
  if (lastAt > 0) return spec.slice(0, lastAt)
  return spec
}

function pluginDisplayName(spec: string): string {
  if (!spec.startsWith("file://")) return spec
  try {
    const pathname = new URL(spec).pathname
    const nodeModulesMarker = "/node_modules/"
    const index = pathname.lastIndexOf(nodeModulesMarker)
    if (index >= 0) {
      const remainder = pathname.slice(index + nodeModulesMarker.length)
      const parts = remainder.split("/").filter(Boolean)
      if (parts[0]?.startsWith("@") && parts.length > 1) {
        return `${parts[0]}/${parts[1]}`
      }
      if (parts[0]) return parts[0]
    }
    return stripExtension(baseName(pathname))
  } catch {
    return spec
  }
}

function pluginSource(spec: string): { label: string; location?: string } {
  if (!spec.startsWith("file://")) return { label: "npm" }
  try {
    const pathname = new URL(spec).pathname
    if (pathname.includes("/node_modules/")) return { label: "npm", location: pathname }
    if (pathname.includes("/.opencode/plugin") || pathname.includes("/.opencode/plugins")) {
      return { label: "project", location: pathname }
    }
    if (pathname.includes("/.config/opencode/plugin") || pathname.includes("/.config/opencode/plugins")) {
      return { label: "global", location: pathname }
    }
    return { label: "file", location: pathname }
  } catch {
    return { label: "file" }
  }
}

export const OpenCodePluginsPanel: Component = () => {
  const sdk = useSDK()
  const sync = useSync()
  const [saving, setSaving] = createSignal<string | null>(null)

  const disabledList = () => sync.data.config.disabled_plugins ?? []

  const items = createMemo<OpenCodePluginItem[]>(() => {
    const disabled = new Set(disabledList())
    return (sync.data.config.plugin ?? [])
      .map((spec) => {
        const canonical = pluginCanonical(spec)
        const display = pluginDisplayName(spec)
        const source = pluginSource(spec)
        const isDisabled = disabled.has(spec) || disabled.has(canonical)
        return {
          spec,
          canonical,
          name: display,
          source: source.label,
          enabled: !isDisabled,
          location: source.location,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  const updateDisabledPlugins = async (nextDisabled: string[]) => {
    const error = await sdk.client.config
      .update({ config: { disabled_plugins: nextDisabled } })
      .then(() => undefined)
      .catch((err) => err as Error)
    if (error) {
      showToast({
        variant: "error",
        title: "Failed to update plugins",
        description: error.message,
      })
      return false
    }
    sync.set("config", "disabled_plugins", nextDisabled)
    return true
  }

  const togglePlugin = async (item: OpenCodePluginItem, nextEnabled: boolean) => {
    if (saving()) return
    setSaving(item.spec)
    const disabled = new Set(disabledList())
    if (nextEnabled) {
      disabled.delete(item.spec)
      disabled.delete(item.canonical)
    } else {
      disabled.add(item.spec)
    }
    const success = await updateDisabledPlugins(Array.from(disabled))
    if (success) {
      showToast({
        variant: "success",
        title: nextEnabled ? "Plugin enabled" : "Plugin disabled",
        description: item.name,
      })
    }
    setSaving(null)
  }

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between px-2.5 pb-2">
        <div class="text-12-regular text-text-weak">
          OpenCode plugins are loaded from `.opencode/plugin`, `~/.config/opencode/plugin`, and your config.
        </div>
      </div>
      <List
        search={{ placeholder: "Search OpenCode plugins", autofocus: false }}
        emptyMessage="No OpenCode plugins found"
        key={(x) => x?.spec ?? ""}
        items={items()}
        filterKeys={["name", "source", "spec"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        onSelect={(x) => {
          if (x) togglePlugin(x, !x.enabled)
        }}
      >
        {(item) => (
          <div class="w-full flex items-center justify-between gap-x-3">
            <div class="flex flex-col gap-0.5 min-w-0">
              <div class="flex items-center gap-2">
                <span class="truncate text-13-regular text-text-strong">{item.name}</span>
                <Tag>{item.source}</Tag>
                <Show when={!item.enabled}>
                  <span class="text-11-regular text-text-weaker">disabled</span>
                </Show>
              </div>
              <Show when={item.location}>
                <span class="text-11-regular text-text-weaker truncate">{item.location}</span>
              </Show>
            </div>
            <div class="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button
                size="small"
                variant="ghost"
                disabled={saving() === item.spec}
                onClick={() => togglePlugin(item, !item.enabled)}
              >
                {item.enabled ? "Disable" : "Enable"}
              </Button>
              <Switch checked={item.enabled} disabled={saving() === item.spec} onChange={() => togglePlugin(item, !item.enabled)} />
            </div>
          </div>
        )}
      </List>
    </div>
  )
}

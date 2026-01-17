import { createMemo, createResource, createSignal, For, Match, Show, Switch, type Component } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tag } from "@opencode-ai/ui/tag"
import { Switch as ToggleSwitch } from "@opencode-ai/ui/switch"
import { useSDK } from "@/context/sdk"

interface InstalledPlugin {
  id: string
  source: "local" | "marketplace"
  path: string
  enabled: boolean
  manifest: {
    name: string
    version: string
    description?: string
    author?: { name: string; email?: string } | string
  }
  installedAt: number
}

interface MarketplaceEntry {
  id: string
  name: string
  version?: string
  description?: string
  author?: { name: string; email?: string }
  source: string | { source: string; url: string }
  tags?: string[]
  category?: string
  homepage?: string
}

interface PluginStats {
  name: string
  downloads: number
  stars: number
  version?: string
}

export type ClaudePluginsPanelProps = {
  variant?: "dialog" | "page"
}

const categoryIcons: Record<string, string> = {
  development: "code",
  productivity: "checklist",
  testing: "check",
  database: "server",
  design: "photo",
  monitoring: "glasses",
  deployment: "share",
  security: "glasses",
  learning: "brain",
}

function formatDownloads(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

export const ClaudePluginsPanel: Component<ClaudePluginsPanelProps> = (props) => {
  const sdk = useSDK()
  const [tab, setTab] = createSignal<"installed" | "available">("available")
  const [loading, setLoading] = createSignal<string | null>(null)
  const [searchQuery, setSearchQuery] = createSignal("")

  const isPage = () => props.variant === "page"

  const buildUrl = (path: string) => {
    const url = new URL(path, sdk.url)
    url.searchParams.set("directory", sdk.directory)
    return url.toString()
  }

  const [installed, { refetch: refetchInstalled }] = createResource(async () => {
    try {
      const response = await fetch(buildUrl("/claude-plugin/installed"))
      if (!response.ok) return []
      return (await response.json()) as InstalledPlugin[]
    } catch {
      return []
    }
  })

  const [marketplace, { refetch: refetchMarketplace }] = createResource(async () => {
    try {
      const response = await fetch(buildUrl("/claude-plugin/marketplace"))
      if (!response.ok) return []
      return (await response.json()) as MarketplaceEntry[]
    } catch {
      return []
    }
  })

  const [stats] = createResource(async () => {
    try {
      const response = await fetch(buildUrl("/claude-plugin/stats"))
      if (!response.ok) return {} as Record<string, PluginStats>
      const text = await response.text()
      if (!text || text.startsWith("<")) return {} as Record<string, PluginStats>
      return JSON.parse(text) as Record<string, PluginStats>
    } catch {
      return {} as Record<string, PluginStats>
    }
  })

  const getDownloads = (name: string): number => {
    const s = stats()
    if (!s) return 0
    return s[name.toLowerCase()]?.downloads ?? 0
  }

  const availablePlugins = createMemo(() => {
    const installedIds = new Set(installed()?.map((p) => p.manifest.name) ?? [])
    const s = stats() ?? {}
    return (marketplace() ?? [])
      .filter((p) => !installedIds.has(p.name))
      .sort((a, b) => {
        const aDownloads = s[a.name.toLowerCase()]?.downloads ?? 0
        const bDownloads = s[b.name.toLowerCase()]?.downloads ?? 0
        return bDownloads - aDownloads
      })
  })

  const filteredInstalled = createMemo(() => {
    const query = searchQuery().toLowerCase()
    if (!query) return installed() ?? []
    return (installed() ?? []).filter(
      (p) => p.manifest.name.toLowerCase().includes(query) || p.manifest.description?.toLowerCase().includes(query),
    )
  })

  const filteredAvailable = createMemo(() => {
    const query = searchQuery().toLowerCase()
    if (!query) return availablePlugins()
    return availablePlugins().filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query) ||
        p.tags?.some((t) => t.toLowerCase().includes(query)),
    )
  })

  async function installPlugin(id: string) {
    setLoading(id)
    try {
      await fetch(buildUrl("/claude-plugin/install"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      await refetchInstalled()
      await refetchMarketplace()
    } finally {
      setLoading(null)
    }
  }

  async function uninstallPlugin(id: string) {
    setLoading(id)
    try {
      await fetch(buildUrl("/claude-plugin/uninstall"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      await refetchInstalled()
    } finally {
      setLoading(null)
    }
  }

  async function togglePlugin(id: string, enabled: boolean) {
    setLoading(id)
    try {
      const endpoint = enabled ? "enable" : "disable"
      await fetch(buildUrl(`/claude-plugin/${endpoint}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      await refetchInstalled()
    } finally {
      setLoading(null)
    }
  }

  async function refreshMarketplace() {
    setLoading("refresh")
    try {
      await fetch(buildUrl("/claude-plugin/marketplace/refresh"), { method: "POST" })
      await refetchMarketplace()
    } finally {
      setLoading(null)
    }
  }

  function getAuthorName(author: { name: string; email?: string } | string | undefined): string {
    if (!author) return ""
    if (typeof author === "string") return author
    return author.name
  }

  function getMarketplaceAuthorName(author: { name: string; email?: string } | undefined): string {
    if (!author) return ""
    return author.name
  }

  return (
    <div class={isPage() ? "size-full flex flex-col" : "flex flex-col gap-3"}>
      <div
        classList={{
          "flex items-center justify-between border-b border-border-base": true,
          "p-6": isPage(),
          "px-2.5 pt-1 pb-2": !isPage(),
        }}
      >
        <div class="flex flex-col gap-1">
          <div class={isPage() ? "text-18-medium text-text-strong" : "text-14-medium text-text-strong"}>
            Claude Code Plugins
          </div>
          <Show when={isPage()}>
            <p class="text-14-regular text-text-base">Discover and manage Claude Code plugins</p>
          </Show>
        </div>
        <Button
          variant="ghost"
          size="normal"
          icon="magnifying-glass"
          disabled={loading() === "refresh"}
          onClick={refreshMarketplace}
        >
          Refresh
        </Button>
      </div>

      <div
        classList={{
          "flex gap-4 items-center border-b border-border-base": true,
          "px-6 py-4": isPage(),
          "px-2.5 pb-2": !isPage(),
        }}
      >
        <div class="flex gap-2">
          <Button variant={tab() === "available" ? "primary" : "ghost"} onClick={() => setTab("available")}>
            Available
            <Show when={availablePlugins().length}>
              <Tag>{availablePlugins().length}</Tag>
            </Show>
          </Button>
          <Button variant={tab() === "installed" ? "primary" : "ghost"} onClick={() => setTab("installed")}>
            Installed
            <Show when={installed()?.length}>
              <Tag>{installed()?.length}</Tag>
            </Show>
          </Button>
        </div>
        <div class="flex-1" />
        <input
          type="text"
          placeholder="Search plugins..."
          class="px-3 py-2 w-64 rounded-md bg-surface-raised-base border border-border-base text-14-regular text-text-base placeholder:text-text-weak focus:outline-none focus:border-border-strong-base"
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
        />
      </div>

      <div
        classList={{
          "overflow-auto": true,
          "flex-1 p-6": isPage(),
          "max-h-[52vh] px-2.5 pb-2": !isPage(),
        }}
      >
        <Switch>
          <Match when={tab() === "available"}>
            <Show
              when={!marketplace.loading}
              fallback={
                <div class="flex flex-col items-center justify-center py-12 text-text-weak">
                  <Icon name="magnifying-glass" class="size-8 animate-pulse opacity-50" />
                  <p class="mt-4 text-14-regular">Loading marketplace...</p>
                </div>
              }
            >
              <Show
                when={filteredAvailable().length > 0}
                fallback={
                  <div class="flex flex-col items-center justify-center py-12 text-text-weak">
                    <Icon name="folder" class="size-12 opacity-50" />
                    <p class="mt-4 text-14-regular">
                      {searchQuery() ? "No plugins match your search" : "No plugins available"}
                    </p>
                  </div>
                }
              >
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  <For each={filteredAvailable()}>
                    {(plugin) => (
                      <div class="flex flex-col p-4 rounded-lg bg-surface-raised-base border border-border-base hover:border-border-strong-base transition-colors">
                        <div class="flex items-start justify-between gap-3">
                          <div class="flex items-center gap-2 min-w-0 flex-1">
                            <div class="flex items-center justify-center size-8 rounded-md bg-surface-base shrink-0">
                              <Icon
                                name={(categoryIcons[plugin.category ?? ""] ?? "mcp") as never}
                                class="size-4 text-text-weak"
                              />
                            </div>
                            <div class="min-w-0 flex-1">
                              <h3 class="text-14-medium text-text-strong truncate">{plugin.name}</h3>
                              <Show when={getMarketplaceAuthorName(plugin.author)}>
                                <p class="text-12-regular text-text-weak truncate">
                                  by {getMarketplaceAuthorName(plugin.author)}
                                </p>
                              </Show>
                            </div>
                          </div>
                          <Button
                            variant="primary"
                            size="small"
                            disabled={loading() === plugin.id}
                            onClick={() => installPlugin(plugin.id)}
                            class="shrink-0"
                          >
                            {loading() === plugin.id ? "..." : "Install"}
                          </Button>
                        </div>

                        <Show when={plugin.description}>
                          <p class="mt-3 text-13-regular text-text-base line-clamp-2">{plugin.description}</p>
                        </Show>

                        <div class="mt-3 pt-3 border-t border-border-base flex items-center justify-between">
                          <div class="flex items-center gap-2 flex-wrap">
                            <Show when={plugin.category}>
                              <Tag>{plugin.category}</Tag>
                            </Show>
                            <Show when={getDownloads(plugin.name) > 0}>
                              <span class="text-12-regular text-text-weak flex items-center gap-1">
                                <Icon name="download" class="size-3" />
                                {formatDownloads(getDownloads(plugin.name))}
                              </span>
                            </Show>
                          </div>
                          <Show when={plugin.homepage}>
                            <a
                              href={plugin.homepage}
                              target="_blank"
                              rel="noopener noreferrer"
                              class="text-12-regular text-text-weak hover:text-text-base flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Icon name="square-arrow-top-right" class="size-3" />
                              Docs
                            </a>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </Match>

          <Match when={tab() === "installed"}>
            <Show
              when={filteredInstalled().length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center py-12 text-text-weak">
                  <Icon name="folder" class="size-12 opacity-50" />
                  <p class="mt-4 text-14-regular">No plugins installed</p>
                  <Button variant="ghost" class="mt-2" onClick={() => setTab("available")}>
                    Browse available plugins
                  </Button>
                </div>
              }
            >
              <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                <For each={filteredInstalled()}>
                  {(plugin) => (
                    <div class="flex flex-col p-4 rounded-lg bg-surface-raised-base border border-border-base">
                      <div class="flex items-start justify-between gap-3">
                        <div class="flex items-center gap-2 min-w-0 flex-1">
                          <div class="flex items-center justify-center size-8 rounded-md bg-surface-base shrink-0">
                            <Icon name="mcp" class="size-4 text-text-weak" />
                          </div>
                          <div class="min-w-0 flex-1">
                            <h3 class="text-14-medium text-text-strong truncate">{plugin.manifest.name}</h3>
                            <Show when={getAuthorName(plugin.manifest.author)}>
                              <p class="text-12-regular text-text-weak truncate">
                                by {getAuthorName(plugin.manifest.author)}
                              </p>
                            </Show>
                          </div>
                        </div>
                        <ToggleSwitch
                          checked={plugin.enabled}
                          disabled={loading() === plugin.id}
                          onChange={() => togglePlugin(plugin.id, !plugin.enabled)}
                        />
                      </div>

                      <Show when={plugin.manifest.description}>
                        <p class="mt-3 text-13-regular text-text-base line-clamp-2">{plugin.manifest.description}</p>
                      </Show>

                      <div class="mt-3 pt-3 border-t border-border-base flex items-center justify-between">
                        <div class="flex items-center gap-2">
                          <Tag>{plugin.manifest.version}</Tag>
                          <Tag>{plugin.source}</Tag>
                        </div>
                        <Button
                          variant="ghost"
                          size="small"
                          disabled={loading() === plugin.id}
                          onClick={() => uninstallPlugin(plugin.id)}
                        >
                          Uninstall
                        </Button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Match>
        </Switch>
      </div>
    </div>
  )
}

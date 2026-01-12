import { Show, createMemo, createResource, type Accessor } from "solid-js"
import { A, useNavigate, useParams } from "@solidjs/router"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { Popover } from "@opencode-ai/ui/popover"
import { TextField } from "@opencode-ai/ui/text-field"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSync } from "@/context/sync"
import { useLayout } from "@/context/layout"
import { useCommand } from "@/context/command"
import { useServer } from "@/context/server"
import { useLocal } from "@/context/local"
import { useMultiPane } from "@/context/multi-pane"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { SessionLspIndicator } from "@/components/session-lsp-indicator"
import { SessionMcpIndicator } from "@/components/session-mcp-indicator"
import { base64Encode } from "@opencode-ai/util/encode"
import { truncateDirectoryPrefix, getFilename } from "@opencode-ai/util/path"
import { paneCache } from "@/components/multi-pane/pane-cache"
import { iife } from "@opencode-ai/util/iife"
import type { Session } from "@opencode-ai/sdk/v2/client"

export type SessionPaneHeaderMode = "single" | "multi"

export interface SessionPaneHeaderProps {
  mode: SessionPaneHeaderMode
  directory: string
  sessionId?: string
  paneId?: string
  isFocused?: Accessor<boolean>
  onMobileMenuToggle?: () => void
  onSessionChange?: (sessionId: string | undefined) => void
  onDirectoryChange?: (directory: string) => void
  onClose?: () => void
}

export function SessionPaneHeader(props: SessionPaneHeaderProps) {
  const globalSDK = useGlobalSDK()
  const layout = useLayout()
  const params = useParams()
  const navigate = useNavigate()
  const command = useCommand()
  const server = useServer()
  const dialog = useDialog()
  const sync = useSync()
  const local = useLocal()

  const sessions = createMemo(() => (sync.data.session ?? []).filter((s) => !s.parentID))
  const currentSession = createMemo(() => sessions().find((s) => s.id === props.sessionId))
  const shareEnabled = createMemo(() => sync.data.config.share !== "disabled")
  const branch = createMemo(() => sync.data.vcs?.branch)
  const focused = createMemo(() => props.isFocused?.() ?? true)
  const sessionKey = createMemo(() =>
    props.mode === "multi"
      ? `multi-${props.paneId ?? "pane"}-${props.directory}${props.sessionId ? "/" + props.sessionId : ""}`
      : `${params.dir}${props.sessionId ? "/" + props.sessionId : ""}`,
  )
  const view = createMemo(() => layout.view(sessionKey()))

  function navigateToProject(directory: string | undefined) {
    if (!directory) return
    const action = () => {
      if (props.mode === "single") {
        navigate(`/${base64Encode(directory)}`)
      } else {
        props.onDirectoryChange?.(directory)
      }
    }
    queueMicrotask(action)
  }

  function navigateToSession(session: Session | undefined) {
    if (props.mode === "single") {
      if (!session) return
      queueMicrotask(() => navigate(`/${params.dir}/session/${session.id}`))
      return
    }
    queueMicrotask(() => {
      props.onSessionChange?.(session?.id)
    })
  }

  // Multi-pane specific
  const multiPane = props.mode === "multi" ? useMultiPane() : undefined

  function handleAddPane() {
    if (!multiPane) return
    const currentModel = local.model.current()
    const currentAgent = local.agent.current()
    const currentVariant = local.model.variant.current()
    const currentMode = local.mode.current()
    const currentThinking = local.model.thinking.current()

    const newPaneId = multiPane.addPane(props.directory)
    if (newPaneId) {
      paneCache.set(newPaneId, {
        agent: currentAgent?.name,
        model: currentModel ? { providerID: currentModel.provider.id, modelID: currentModel.id } : undefined,
        variant: currentVariant,
        modeId: currentMode?.id,
        thinking: currentThinking,
      })
    }
  }

  // Single mode header (full featured)
  if (props.mode === "single") {
    return (
      <header class="h-12 shrink-0 bg-background-base border-b border-border-weak-base flex" data-tauri-drag-region>
        <button
          type="button"
          class="xl:hidden w-12 shrink-0 flex items-center justify-center border-r border-border-weak-base hover:bg-surface-raised-base-hover active:bg-surface-raised-base-active transition-colors"
          onClick={props.onMobileMenuToggle}
        >
          <Icon name="menu" size="small" />
        </button>
        <div class="px-4 flex items-center justify-between gap-4 w-full">
          <div class="flex items-center gap-3 min-w-0">
            <div class="flex items-center gap-2 min-w-0">
              <div class="hidden xl:flex items-center gap-2">
                <Select
                  options={layout.projects.list().map((project) => project.worktree)}
                  current={sync.directory}
                  label={(x) => {
                    const truncated = truncateDirectoryPrefix(x)
                    const b = x === sync.directory ? branch() : undefined
                    return b ? `${truncated}:${b}` : truncated
                  }}
                  onSelect={(x) => (x ? navigateToProject(x) : undefined)}
                  class="text-14-regular text-text-base"
                  variant="ghost"
                >
                  {/* @ts-ignore */}
                  {(i) => (
                    <div class="flex items-center gap-2">
                      <Icon name="folder" size="small" />
                      <div class="text-text-strong">{truncateDirectoryPrefix(i ?? "")}</div>
                    </div>
                  )}
                </Select>
                <div class="text-text-weaker">/</div>
              </div>
              <Select
                options={sessions()}
                current={currentSession()}
                placeholder="New session"
                label={(x) => x.title}
                value={(x) => x.id}
                onSelect={navigateToSession}
                class="text-14-regular text-text-base max-w-[calc(100vw-180px)] md:max-w-md"
                variant="ghost"
              />
            </div>
            <Show when={currentSession()}>
              <TooltipKeybind class="hidden xl:block" title="New session" keybind={command.keybind("session.new")}>
                <IconButton as={A} href={`/${params.dir}/session`} icon="edit-small-2" variant="ghost" />
              </TooltipKeybind>
            </Show>
          </div>
          <div class="flex items-center gap-3">
            <div class="hidden md:flex items-center gap-1">
              <Button
                size="small"
                variant="ghost"
                onClick={() => {
                  dialog.show(() => <DialogSelectServer />)
                }}
              >
                <div
                  classList={{
                    "size-1.5 rounded-full": true,
                    "bg-icon-success-base": server.healthy() === true,
                    "bg-icon-critical-base": server.healthy() === false,
                    "bg-border-weak-base": server.healthy() === undefined,
                  }}
                />
                <Icon name="server" size="small" class="text-icon-weak" />
                <span class="text-12-regular text-text-weak truncate max-w-[200px]">{server.name}</span>
              </Button>
              <SessionLspIndicator />
              <SessionMcpIndicator />
            </div>
            <div class="flex items-center gap-1">
              <Show when={currentSession()?.summary?.files}>
                <TooltipKeybind
                  class="hidden md:block shrink-0"
                  title="Toggle review"
                  keybind={command.keybind("review.toggle")}
                >
                  <Button variant="ghost" class="group/review-toggle size-6 p-0" onClick={view().reviewPanel.toggle}>
                    <div class="relative flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                      <Icon
                        name={view().reviewPanel.opened() ? "layout-right" : "layout-left"}
                        size="small"
                        class="group-hover/review-toggle:hidden"
                      />
                      <Icon
                        name={view().reviewPanel.opened() ? "layout-right-partial" : "layout-left-partial"}
                        size="small"
                        class="hidden group-hover/review-toggle:inline-block"
                      />
                      <Icon
                        name={view().reviewPanel.opened() ? "layout-right-full" : "layout-left-full"}
                        size="small"
                        class="hidden group-active/review-toggle:inline-block"
                      />
                    </div>
                  </Button>
                </TooltipKeybind>
              </Show>
              <TooltipKeybind
                class="hidden md:block shrink-0"
                title="Toggle terminal"
                keybind={command.keybind("terminal.toggle")}
              >
                <Button variant="ghost" class="group/terminal-toggle size-6 p-0" onClick={view().terminal.toggle}>
                  <div class="relative flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                    <Icon
                      size="small"
                      name={view().terminal.opened() ? "layout-bottom-full" : "layout-bottom"}
                      class="group-hover/terminal-toggle:hidden"
                    />
                    <Icon
                      size="small"
                      name="layout-bottom-partial"
                      class="hidden group-hover/terminal-toggle:inline-block"
                    />
                    <Icon
                      size="small"
                      name={view().terminal.opened() ? "layout-bottom" : "layout-bottom-full"}
                      class="hidden group-active/terminal-toggle:inline-block"
                    />
                  </div>
                </Button>
              </TooltipKeybind>
              <Tooltip class="hidden md:block shrink-0" value="New Tab">
                <IconButton
                  icon="plus"
                  variant="ghost"
                  onClick={() => {
                    const url = props.sessionId
                      ? `/multi?session=${props.sessionId}&dir=${encodeURIComponent(sync.directory)}&newTab=true`
                      : `/multi?dir=${encodeURIComponent(sync.directory)}&newTab=true`
                    navigate(url)
                  }}
                />
              </Tooltip>
            </div>
            <Show when={shareEnabled() && currentSession()}>
              <Popover
                title="Share session"
                trigger={
                  <Tooltip class="shrink-0" value="Share session">
                    <IconButton icon="share" variant="ghost" class="" />
                  </Tooltip>
                }
              >
                {iife(() => {
                  const [url] = createResource(
                    () => currentSession(),
                    async (session) => {
                      if (!session) return
                      let shareURL = session.share?.url
                      if (!shareURL) {
                        shareURL = await globalSDK.client.session
                          .share({ sessionID: session.id, directory: sync.directory })
                          .then((r) => r.data?.share?.url)
                          .catch((e) => {
                            console.error("Failed to share session", e)
                            return undefined
                          })
                      }
                      return shareURL
                    },
                  )
                  return <Show when={url()}>{(url) => <TextField value={url()} readOnly copyable class="w-72" />}</Show>
                })}
              </Popover>
            </Show>
          </div>
        </div>
      </header>
    )
  }

  // Multi mode header (compact overlay)
  return (
    <header
      class="shrink-0 border-b flex flex-col"
      classList={{
        "border-border-accent-base": focused(),
        "border-border-weak-base": !focused(),
      }}
    >
      <div class="h-8 flex items-center px-2 gap-1">
        <div class="flex items-center gap-1 min-w-0 flex-1">
          <Select
            options={layout.projects.list().map((project) => project.worktree)}
            current={props.directory}
            label={(x) => {
              const truncated = truncateDirectoryPrefix(x)
              const b = x === sync.directory ? branch() : undefined
              return b ? `${truncated}:${b}` : truncated
            }}
            onSelect={navigateToProject}
            class="text-12-regular text-text-base"
            variant="ghost"
          />
          <div class="text-text-weaker text-12-regular">/</div>
          <Select
            options={sessions()}
            current={currentSession()}
            placeholder="New"
            label={(x) => x.title}
            value={(x) => x.id}
            onSelect={navigateToSession}
            class="text-12-regular text-text-base max-w-[160px]"
            variant="ghost"
          />
        </div>
        <div class="flex items-center">
          <Show when={currentSession()}>
            <Tooltip value="New session">
              <IconButton icon="edit-small-2" variant="ghost" onClick={() => props.onSessionChange?.(undefined)} />
            </Tooltip>
          </Show>
          <Tooltip value="Toggle terminal">
            <IconButton
              icon={view().terminal.opened() ? "layout-bottom-full" : "layout-bottom"}
              variant="ghost"
              onClick={view().terminal.toggle}
            />
          </Tooltip>
          <Tooltip value="Toggle review">
            <IconButton
              icon={view().reviewPanel.opened() ? "layout-right" : "layout-left"}
              variant="ghost"
              onClick={view().reviewPanel.toggle}
            />
          </Tooltip>
          <Show when={multiPane && (multiPane.panes().length > 1 || !!props.sessionId)}>
            <Tooltip value="Close pane">
              <IconButton icon="close" variant="ghost" onClick={props.onClose} />
            </Tooltip>
          </Show>
        </div>
      </div>
    </header>
  )
}

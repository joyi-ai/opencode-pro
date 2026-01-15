import { Show, createMemo } from "solid-js"
import { Select } from "@opencode-ai/ui/select"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useSync } from "@/context/sync"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { useMultiPane } from "@/context/multi-pane"
import { paneCache } from "@/components/multi-pane/pane-cache"
import { getFilename, truncateDirectoryPrefix } from "@opencode-ai/util/path"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { makeViewKey } from "@/utils/layout-key"

type PaneHeaderProps = {
  paneId: string
  directory: string
  sessionId?: string
  onClose?: () => void
  onSessionChange?: (sessionId: string | undefined) => void
  onDirectoryChange?: (directory: string) => void
}

export function PaneHeader(props: PaneHeaderProps) {
  const layout = useLayout()
  const sync = useSync()
  const local = useLocal()
  const multiPane = useMultiPane()
  const viewKey = createMemo(() => makeViewKey({ paneId: props.paneId, directory: props.directory }))
  const view = createMemo(() => layout.view(viewKey()))

  const sessions = createMemo(() => (sync.data.session ?? []).filter((s) => !s.parentID))
  const currentSession = createMemo(() => sessions().find((s) => s.id === props.sessionId))
  const branch = createMemo(() => sync.data.vcs?.branch)

  function handleSessionSelect(session: Session | undefined) {
    queueMicrotask(() => {
      props.onSessionChange?.(session?.id)
    })
  }

  function handleDirectorySelect(directory: string | undefined) {
    if (!directory) return
    queueMicrotask(() => {
      props.onDirectoryChange?.(directory)
    })
  }

  function handleAddPane() {
    // Copy current settings to the new pane
    const currentModel = local.model.current()
    const currentAgent = local.agent.current()
    const currentVariant = local.model.variant.current()
    const currentMode = local.mode.current()
    const currentThinking = local.model.thinking.current()

    const newPaneId = multiPane.addPane(props.directory)
    if (newPaneId) {
      // Pre-populate the new pane's cache with current settings
      paneCache.set(newPaneId, {
        agent: currentAgent?.name,
        model: currentModel ? { providerID: currentModel.provider.id, modelID: currentModel.id } : undefined,
        variant: currentVariant,
        modeId: currentMode?.id,
        thinking: currentThinking,
      })
    }
  }

  return (
    <header class="shrink-0 bg-background-base border-b border-border-accent-base flex flex-col">
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
            onSelect={handleDirectorySelect}
            class="text-12-regular text-text-base"
            variant="ghost"
          />
          <div class="text-text-weaker text-12-regular">/</div>
          <Select
            options={sessions()}
            current={currentSession()}
            placeholder="New"
            label={() => ""}
            value={(x) => x.id}
            onSelect={handleSessionSelect}
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
          <Tooltip value="New tab">
            <IconButton icon="plus" variant="ghost" onClick={handleAddPane} />
          </Tooltip>
          <Show when={multiPane.panes().length > 1}>
            <Tooltip value="Close pane">
              <IconButton icon="close" variant="ghost" onClick={props.onClose} />
            </Tooltip>
          </Show>
        </div>
      </div>
    </header>
  )
}

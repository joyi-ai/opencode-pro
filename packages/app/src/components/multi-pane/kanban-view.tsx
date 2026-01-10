import { For, Show, createMemo } from "solid-js"
import { useMultiPane, type PaneConfig } from "@/context/multi-pane"
import { useGlobalSync } from "@/context/global-sync"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"
import { TerminalProvider } from "@/context/terminal"
import { PromptProvider } from "@/context/prompt"
import { FileProvider } from "@/context/file"
import { DataProvider } from "@opencode-ai/ui/context"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Spinner } from "@opencode-ai/ui/spinner"
import { DragDropProvider } from "@thisbeyond/solid-dnd"
import { SessionPane } from "@/components/session-pane"
import { MultiPanePromptPanel } from "./prompt-panel"
import { PaneHome } from "./pane-home"
import { getPaneProjectLabel, getPaneState, getPaneTitle, getPaneWorking } from "@/utils/pane"

type Column = {
  id: string
  title: string
  panes: PaneConfig[]
}

function PaneCard(props: { pane: PaneConfig }) {
  const multiPane = useMultiPane()
  const globalSync = useGlobalSync()

  const focused = createMemo(() => multiPane.focusedPaneId() === props.pane.id)

  const title = createMemo(() => getPaneTitle(props.pane, globalSync) ?? "New session")
  const subtitle = createMemo(() => getPaneProjectLabel(props.pane) ?? "No project")
  const working = createMemo(() => getPaneWorking(props.pane, globalSync))

  return (
    <button
      type="button"
      class="group flex flex-col gap-1 w-full rounded-md border px-3 py-2 text-left shadow-xs-border-base transition-colors"
      classList={{
        "border-border-accent-base bg-surface-raised-base-active": focused(),
        "border-border-weak-base bg-surface-raised-base hover:bg-surface-raised-base-hover": !focused(),
      }}
      onClick={() => multiPane.setFocused(props.pane.id)}
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-13-medium text-text-strong truncate">{title()}</div>
        </div>
        <Show when={working()}>
          <Spinner class="size-3 mt-0.5 shrink-0" />
        </Show>
      </div>
      <div class="text-11-regular text-text-weak truncate">{subtitle()}</div>
    </button>
  )
}

function PaneColumns(props: { panes: PaneConfig[] }) {
  const multiPane = useMultiPane()
  const globalSync = useGlobalSync()
  const focusedPaneId = createMemo(() => multiPane.focusedPaneId())

  const columns = createMemo<Column[]>(() => {
    const inProgress: PaneConfig[] = []
    const inReview: PaneConfig[] = []
    const done: PaneConfig[] = []

    for (const pane of props.panes) {
      const sessionId = pane.sessionId
      const directory = pane.directory

      if (!sessionId || !directory) {
        inProgress.push(pane)
        continue
      }

      const [store] = globalSync.child(directory)
      const status = store.session_status[sessionId]
      if (status?.type === "busy" || status?.type === "retry") {
        inProgress.push(pane)
        continue
      }

      const session = store.session.find((candidate) => candidate.id === sessionId)
      if (session?.summary?.files) {
        inReview.push(pane)
        continue
      }

      done.push(pane)
    }

    return [
      { id: "in-progress", title: "In progress", panes: inProgress },
      { id: "in-review", title: "In review", panes: inReview },
      { id: "done", title: "Done", panes: done },
    ]
  })

  function addToColumn(directory: string | undefined) {
    const focused = multiPane.focusedPane()
    const fallback = focused?.directory
    multiPane.addPane(directory ?? fallback)
  }

  return (
    <div class="flex-1 min-w-0 min-h-0 overflow-x-auto overflow-y-hidden">
      <div class="h-full flex items-stretch gap-4 p-4">
        <For each={columns()}>
          {(col) => {
            const active = createMemo(() => col.panes.some((pane) => pane.id === focusedPaneId()))
            return (
              <div class="w-72 shrink-0 flex flex-col min-h-0">
                <div class="flex items-center justify-between px-1 pb-2">
                  <div class="text-11-medium text-text-weak uppercase tracking-wide">{col.title}</div>
                  <Tooltip value="New tab" placement="bottom">
                    <IconButton icon="plus" variant="ghost" onClick={() => addToColumn(undefined)} />
                  </Tooltip>
                </div>
                <div
                  class="flex-1 min-h-0 border p-2 overflow-y-auto no-scrollbar flex flex-col gap-2"
                  classList={{
                    "border-border-accent-base": active(),
                    "border-border-strong-base": !active(),
                  }}
                >
                  <For each={col.panes}>{(pane) => <PaneCard pane={pane} />}</For>
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}

function SidePanelSynced(props: { paneId: string; directory: string; sessionId?: string }) {
  const multiPane = useMultiPane()
  const sync = useSync()
  const sdk = useSDK()
  const respond = (input: { sessionID: string; permissionID: string; response: "once" | "always" | "reject" }) =>
    sdk.client.permission.respond(input)

  const isFocused = createMemo(() => multiPane.focusedPaneId() === props.paneId)

  return (
    <DataProvider data={sync.data} directory={props.directory} onPermissionRespond={respond}>
      <LocalProvider>
        <TerminalProvider paneId={props.paneId}>
          <FileProvider>
            <PromptProvider paneId={props.paneId}>
              <div class="flex-1 min-h-0 flex flex-col">
                <div class="flex-1 min-h-0 overflow-hidden">
                  <DragDropProvider>
                    <SessionPane
                      mode="multi"
                      paneId={props.paneId}
                      directory={props.directory}
                      sessionId={props.sessionId}
                      isFocused={isFocused}
                      reviewMode="global"
                      onSessionChange={(sessionId: string | undefined) =>
                        multiPane.updatePane(props.paneId, { sessionId })
                      }
                      onDirectoryChange={(dir: string) =>
                        multiPane.updatePane(props.paneId, { directory: dir, sessionId: undefined })
                      }
                      onClose={() => multiPane.removePane(props.paneId)}
                    />
                  </DragDropProvider>
                </div>
                <MultiPanePromptPanel paneId={props.paneId} sessionId={props.sessionId} />
              </div>
            </PromptProvider>
          </FileProvider>
        </TerminalProvider>
      </LocalProvider>
    </DataProvider>
  )
}

function PaneSidePanel() {
  const multiPane = useMultiPane()
  const focused = createMemo(() => multiPane.focusedPane())

  return (
    <div
      class="shrink-0 h-full border-l border-border-weak-base bg-background-base flex flex-col min-h-0"
      style={{ width: "clamp(360px, 38vw, 560px)" }}
    >
      <Show
        when={focused()}
        fallback={
          <div class="flex-1 min-h-0 flex items-center justify-center text-text-weak text-12-regular">Select a tab</div>
        }
      >
        {(pane) => (
          <Show
            when={getPaneState(pane()) === "session"}
            fallback={
              <PaneHome
                paneId={pane().id}
                isFocused={() => multiPane.focusedPaneId() === pane().id}
                selectedProject={pane().directory}
                showBorder={false}
              />
            }
          >
            {(_) => (
              <SDKProvider directory={pane().directory!}>
                <SyncProvider>
                  <SidePanelSynced paneId={pane().id} directory={pane().directory!} sessionId={pane().sessionId!} />
                </SyncProvider>
              </SDKProvider>
            )}
          </Show>
        )}
      </Show>
    </div>
  )
}

export function MultiPaneKanbanView(props: { panes: PaneConfig[] }) {
  return (
    <div class="flex-1 min-h-0 flex">
      <div class="flex-1 min-w-0 min-h-0 flex flex-col">
        <PaneColumns panes={props.panes} />
      </div>
      <PaneSidePanel />
    </div>
  )
}

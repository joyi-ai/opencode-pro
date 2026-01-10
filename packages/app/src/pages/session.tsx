import { Show, createMemo, createEffect, For } from "solid-js"
import { useParams } from "@solidjs/router"
import { SessionPane } from "@/components/session-pane"
import { PromptInput } from "@/components/prompt-input"
import { Terminal } from "@/components/terminal"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  closestCenter,
  createSortable,
} from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { useTerminal, type LocalPTY } from "@/context/terminal"
import { useLayout } from "@/context/layout"
import { useCommand } from "@/context/command"
import { base64Decode } from "@opencode-ai/util/encode"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { createStore } from "solid-js/store"

function SortableTerminalTab(props: { terminal: LocalPTY }) {
  const terminal = useTerminal()
  const sortable = createSortable(props.terminal.id)
  return (
    // @ts-ignore
    <div use:sortable classList={{ "h-full": true, "opacity-0": sortable.isActiveDraggable }}>
      <div class="relative h-full">
        <Tabs.Trigger
          value={props.terminal.id}
          closeButton={
            terminal.all().length > 1 && (
              <IconButton icon="close" variant="ghost" onClick={() => terminal.close(props.terminal.id)} />
            )
          }
        >
          {props.terminal.title}
        </Tabs.Trigger>
      </div>
    </div>
  )
}

export default function Page() {
  const params = useParams()
  const layout = useLayout()
  const terminal = useTerminal()
  const command = useCommand()
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const view = createMemo(() => layout.view(sessionKey()))

  const [store, setStore] = createStore({
    activeTerminalDraggable: undefined as string | undefined,
  })

  const directory = createMemo(() => (params.dir ? base64Decode(params.dir) : ""))

  let inputRef: HTMLDivElement | undefined

  // Auto-create terminal when terminal panel opens
  createEffect(() => {
    if (view().terminal.opened()) {
      if (terminal.all().length === 0) {
        terminal.new()
      }
    }
  })

  // Terminal drag handlers
  function handleTerminalDragStart(event: unknown) {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeTerminalDraggable", id)
  }

  function handleTerminalDragOver(event: DragEvent) {
    const { draggable, droppable } = event
    if (draggable && droppable) {
      const terminals = terminal.all()
      const fromIndex = terminals.findIndex((t: LocalPTY) => t.id === draggable.id.toString())
      const toIndex = terminals.findIndex((t: LocalPTY) => t.id === droppable.id.toString())
      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        terminal.move(draggable.id.toString(), toIndex)
      }
    }
  }

  function handleTerminalDragEnd() {
    setStore("activeTerminalDraggable", undefined)
  }

  return (
    <div class="relative bg-background-base size-full overflow-hidden flex flex-col">
      {/* Session Pane (single mode) */}
      <SessionPane mode="single" directory={directory()} sessionId={params.id} promptInputRef={() => inputRef} />

      {/* Prompt Input - absolute positioned for mobile, relative for desktop */}
      <div class="md:hidden absolute inset-x-0 bottom-4 flex flex-col justify-center items-center z-50 px-4">
        <div class="w-full">
          <PromptInput
            ref={(el) => {
              inputRef = el
            }}
          />
        </div>
      </div>
      <div class="hidden md:block absolute inset-x-0 bottom-8 flex flex-col justify-center items-center z-50">
        <div class="w-full px-6 max-w-200 mx-auto">
          <PromptInput
            ref={(el) => {
              inputRef = el
            }}
          />
        </div>
      </div>

      {/* Terminal Panel - External */}
      <Show when={view().terminal.opened()}>
        <div
          class="hidden md:flex relative w-full flex-col shrink-0 border-t border-border-weak-base"
          style={{ height: `${layout.terminal.height()}px` }}
        >
          <ResizeHandle
            direction="vertical"
            size={layout.terminal.height()}
            min={100}
            max={window.innerHeight * 0.6}
            collapseThreshold={50}
            onResize={layout.terminal.resize}
            onCollapse={view().terminal.close}
          />
          <DragDropProvider
            onDragStart={handleTerminalDragStart}
            onDragEnd={handleTerminalDragEnd}
            onDragOver={handleTerminalDragOver}
            collisionDetector={closestCenter}
          >
            <DragDropSensors />
            <ConstrainDragYAxis />
            <Tabs variant="alt" value={terminal.active()} onChange={terminal.open}>
              <Tabs.List class="h-10">
                <SortableProvider ids={terminal.all().map((t: LocalPTY) => t.id)}>
                  <For each={terminal.all()}>{(pty) => <SortableTerminalTab terminal={pty} />}</For>
                </SortableProvider>
                <div class="h-full flex items-center justify-center">
                  <TooltipKeybind
                    title="New terminal"
                    keybind={command.keybind("terminal.new")}
                    class="flex items-center"
                  >
                    <IconButton icon="plus-small" variant="ghost" iconSize="large" onClick={terminal.new} />
                  </TooltipKeybind>
                </div>
              </Tabs.List>
              <For each={terminal.all()}>
                {(pty) => (
                  <Tabs.Content value={pty.id}>
                    <Terminal pty={pty} onCleanup={terminal.update} onConnectError={() => terminal.clone(pty.id)} />
                  </Tabs.Content>
                )}
              </For>
            </Tabs>
            <DragOverlay>
              <Show when={store.activeTerminalDraggable}>
                {(draggedId) => {
                  const pty = createMemo(() => terminal.all().find((t: LocalPTY) => t.id === draggedId()))
                  return (
                    <Show when={pty()}>
                      {(t) => (
                        <div class="relative p-1 h-10 flex items-center bg-background-stronger text-14-regular">
                          {t().title}
                        </div>
                      )}
                    </Show>
                  )
                }}
              </Show>
            </DragOverlay>
          </DragDropProvider>
        </div>
      </Show>
    </div>
  )
}

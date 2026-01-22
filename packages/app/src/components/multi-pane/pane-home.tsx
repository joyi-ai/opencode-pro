import { Show, createEffect, createMemo, createSignal } from "solid-js"
import { createDraggable, createDroppable } from "@thisbeyond/solid-dnd"
import { useMultiPane } from "@/context/multi-pane"
import { HomeScreen } from "@/components/home-screen"
import { usePreferredProject } from "@/hooks/use-preferred-project"
import { useHeaderOverlay } from "@/hooks/use-header-overlay"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"

type PaneHomeProps = {
  paneId: string
  isFocused: () => boolean
  selectedProject?: string
  currentWorktree?: string
  showBorder?: boolean
}

export function PaneHome(props: PaneHomeProps) {
  const multiPane = useMultiPane()
  const preferredProject = usePreferredProject()
  const [autoSelected, setAutoSelected] = createSignal(false)
  const headerOverlay = useHeaderOverlay({ mode: "overlay", isFocused: props.isFocused })
  const paneDraggable = createDraggable(props.paneId)
  const paneDroppable = createDroppable(props.paneId)
  const paneDragHandlers = paneDraggable.dragActivators

  const variant = createMemo(() => (multiPane.panes().length > 1 ? "pane" : "page"))
  const hideLogo = createMemo(() => multiPane.panes().length > 1)
  const showRelativeTime = createMemo(() => multiPane.panes().length <= 1)
  const showThemePicker = createMemo(() => multiPane.panes().length === 1)
  const showBorder = createMemo(() => props.showBorder ?? multiPane.panes().length > 1)

  function updatePane(directory: string) {
    multiPane.updatePane(props.paneId, { directory, worktree: undefined, sessionId: undefined })
    multiPane.setFocused(props.paneId)
  }

  createEffect(() => {
    if (props.selectedProject !== undefined) return
    if (autoSelected()) return
    if (!props.isFocused()) return
    const candidate = preferredProject()
    if (!candidate) return
    setAutoSelected(true)
    updatePane(candidate)
  })

  function handleProjectSelected(directory: string) {
    updatePane(directory)
  }

  function handleWorktreeSelected(worktree: string | undefined) {
    multiPane.updatePane(props.paneId, { worktree })
    multiPane.setFocused(props.paneId)
  }

  function handleNavigateMulti() {
    multiPane.addPaneFromFocused()
  }

  function handleMouseDown(event: MouseEvent) {
    const target = event.target as HTMLElement
    const isInteractive = target.closest('button, input, select, textarea, [contenteditable], [role="button"]')
    if (!isInteractive) {
      multiPane.setFocused(props.paneId)
    }
  }

  function setContainerRef(el: HTMLDivElement) {
    headerOverlay.containerRef(el)
    paneDroppable.ref(el)
  }

  function setHeaderDragRef(el: HTMLDivElement) {
    paneDraggable.ref(el)
  }

  return (
    <div
      ref={setContainerRef}
      class="relative size-full flex flex-col overflow-hidden transition-all duration-150"
      style={{
        opacity: multiPane.panes().length > 1 && !props.isFocused() ? 0.5 : 1,
      }}
      onMouseDown={handleMouseDown}
      onMouseEnter={headerOverlay.handleMouseEnter}
      onMouseLeave={headerOverlay.handleMouseLeave}
      onMouseMove={headerOverlay.handleMouseMove}
    >
      <Show when={multiPane.panes().length > 1}>
        <div
          ref={setHeaderDragRef}
          class="absolute top-0 left-0 right-0 z-40 transition-opacity duration-150"
          classList={{
            "opacity-100 pointer-events-auto": headerOverlay.showHeader(),
            "opacity-0 pointer-events-none": !headerOverlay.showHeader(),
            "cursor-grab": true,
            "cursor-grabbing": paneDraggable.isActiveDraggable,
          }}
          {...paneDragHandlers}
          onMouseDown={(event) => {
            // Allow right-click to bubble up to the pane grid so the radial dial
            // can open even when the cursor is over the header overlay.
            if (event.button === 2) return
            event.stopPropagation()
          }}
          onMouseEnter={() => headerOverlay.setIsOverHeader(true)}
          onMouseLeave={() => headerOverlay.setIsOverHeader(false)}
          onFocusIn={() => headerOverlay.setHeaderHasFocus(true)}
          onFocusOut={(event) => {
            const relatedTarget = event.relatedTarget as HTMLElement | null
            if (!event.currentTarget.contains(relatedTarget)) {
              headerOverlay.setHeaderHasFocus(false)
            }
          }}
        >
          <header
            class="shrink-0 bg-background-stronger border-b flex flex-col"
            classList={{
              "border-border-accent-base": props.isFocused(),
              "border-border-weak-base": !props.isFocused(),
            }}
          >
            <div class="h-8 flex items-center px-2 gap-1">
              <div class="flex items-center min-w-0 flex-1 text-12-regular text-text-weak">New tab</div>
              <Tooltip value="Close pane">
                <IconButton icon="close" variant="ghost" onClick={() => multiPane.removePane(props.paneId)} />
              </Tooltip>
            </div>
          </header>
        </div>
      </Show>
      <Show when={showBorder()}>
        <div
          class="pointer-events-none absolute inset-0 z-30 border"
          classList={{
            "border-border-accent-base": props.isFocused(),
            "border-border-strong-base": !props.isFocused(),
          }}
        />
      </Show>
      <HomeScreen
        variant={variant()}
        selectedProject={props.selectedProject}
        currentWorktree={props.currentWorktree}
        hideLogo={hideLogo()}
        showRelativeTime={showRelativeTime()}
        showThemePicker={showThemePicker()}
        onProjectSelected={handleProjectSelected}
        onWorktreeSelected={handleWorktreeSelected}
        onNavigateMulti={handleNavigateMulti}
      />
    </div>
  )
}

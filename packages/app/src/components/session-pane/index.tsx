import {
  For,
  Show,
  createMemo,
  createEffect,
  on,
  createSignal,
  onCleanup,
  type Accessor,
} from "solid-js"
import { createStore } from "solid-js/store"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { SessionMessageRail } from "@opencode-ai/ui/session-message-rail"
import { Icon } from "@opencode-ai/ui/icon"
import { DateTime } from "luxon"
import { createDraggable, createDroppable } from "@thisbeyond/solid-dnd"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLayout } from "@/context/layout"
import { useMultiPane } from "@/context/multi-pane"
import { useScrollBehavior } from "@/context/scroll-behavior"
import { useHeaderOverlay } from "@/hooks/use-header-overlay"
import { useSessionMessages } from "@/hooks/use-session-messages"
import { useSessionSync } from "@/hooks/use-session-sync"
import { useSessionCommands } from "@/hooks/use-session-commands"
import { useMessageActions } from "@/hooks/use-message-actions"
import { useSessionScroll } from "@/hooks/use-session-scroll"
import { ThemeDropup } from "@/components/theme-dropup"
import { SessionPaneHeader } from "./header"
import { MobileView } from "./mobile-view"
import { ContextTab } from "./context-tab"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { useNotification } from "@/context/notification"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import { makeContextKey, makeSessionKey, makeViewKey } from "@/utils/layout-key"

const MESSAGE_WINDOW_SIZE = 6
const MESSAGE_WINDOW_RESET_MS = 120000
const MESSAGE_WINDOW_TOP_THRESHOLD = 120
const MESSAGE_WINDOW_BOTTOM_THRESHOLD = 50
const MESSAGE_HISTORY_LOAD_DEBOUNCE_MS = 400

export interface SessionPaneProps {
  paneId?: string
  directory: string
  projectDirectory?: string
  worktree?: string
  sessionId?: string
  isFocused?: Accessor<boolean>
  onSessionChange?: (sessionId: string | undefined) => void
  onDirectoryChange?: (directory: string) => void
  onWorktreeChange?: (worktree: string | undefined) => void
  onClose?: () => void
}

export function SessionPane(props: SessionPaneProps) {
  const sync = useSync()
  const sdk = useSDK()
  const layout = useLayout()
  const multiPane = useMultiPane()
  const notification = useNotification()
  const messageActions = useMessageActions()
  const hasMultiplePanes = createMemo(() => multiPane.panes().length > 1)

  // Local state
  const [store, setStore] = createStore({
    stepsExpanded: {} as Record<string, boolean>,
    windowPages: 1,
    windowExpandArmed: true,
    windowNearBottom: true,
    windowResetTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    historyLoadArmed: false,
    historyLoadLocked: false,
    historyLoadTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    initialScrollDone: false,
  })

  const sessionId = createMemo(() => props.sessionId)
  const projectDirectory = createMemo(() => props.projectDirectory ?? props.directory)
  const sessionInfo = createMemo(() => {
    const id = sessionId()
    if (!id) return
    return sync.session.get(id)
  })
  const sessionDirectory = createMemo(() => sessionInfo()?.directory)

  // Directory matching
  const expectedDirectory = createMemo(() => props.directory)
  const sdkDirectoryMatches = createMemo(() => expectedDirectory() !== "" && sdk.directory === expectedDirectory())

  const sessionKey = createMemo(() =>
    makeSessionKey({ paneId: props.paneId, directory: props.directory, sessionId: sessionId() }),
  )
  const contextKey = createMemo(() => makeContextKey({ paneId: props.paneId, directory: props.directory }))
  const viewKey = createMemo(() => makeViewKey({ paneId: props.paneId, directory: props.directory }))

  // Tabs for context panel
  const tabs = createMemo(() => layout.tabs(contextKey()))
  const activeTab = createMemo(() => tabs().active())

  // Todos
  const todos = createMemo(() => {
    const id = sessionId()
    return id ? (sync.data.todo[id] ?? []) : []
  })

  const windowSize = createMemo(() => MESSAGE_WINDOW_SIZE * store.windowPages)

  // Session messages hook
  const sessionMessages = useSessionMessages({
    sessionId,
    windowSize,
  })

  const renderedUserMessages = createMemo(() => sessionMessages.visibleUserMessages())
  const assistant = createMemo(() => {
    const id = sessionId()
    if (!id) return false
    const last = sessionMessages.lastUserMessage()
    if (!last) return false
    const messages = sync.data.message[id] ?? []
    return messages.some((message) => message.role === "assistant" && message.parentID === last.id)
  })

  // Focus state
  const isFocused = createMemo(() => props.isFocused?.() ?? true)

  // Header overlay hook
  const headerOverlay = useHeaderOverlay({
    mode: "overlay",
    isFocused,
  })
  const paneDraggable = props.paneId ? createDraggable(props.paneId) : undefined
  const paneDroppable = props.paneId ? createDroppable(props.paneId) : undefined
  const paneDragHandlers = paneDraggable ? paneDraggable.dragActivators : {}

  // Session sync hook
  useSessionSync({
    sessionId,
    directoryMatches: sdkDirectoryMatches,
  })

  createEffect(
    on(sessionId, () => {
      const timer = store.windowResetTimer
      if (timer) clearTimeout(timer)
      if (timer) setStore("windowResetTimer", undefined)
      const historyTimer = store.historyLoadTimer
      if (historyTimer) clearTimeout(historyTimer)
      if (historyTimer) setStore("historyLoadTimer", undefined)
      setStore("windowPages", 1)
      setStore("windowExpandArmed", true)
      setStore("windowNearBottom", true)
      setStore("historyLoadArmed", false)
      setStore("historyLoadLocked", false)
      setStore("initialScrollDone", false)
      lastScrollTop.value = 0
    }),
  )

  createEffect(
    on(
      () => [store.windowNearBottom, store.windowPages] as const,
      ([nearBottom, pages]) => {
        const timer = store.windowResetTimer
        if (timer) clearTimeout(timer)
        if (timer) setStore("windowResetTimer", undefined)
        if (!nearBottom) return
        if (pages <= 1) return
        const nextTimer = setTimeout(() => {
          setStore("windowPages", 1)
          setStore("windowExpandArmed", true)
        }, MESSAGE_WINDOW_RESET_MS)
        setStore("windowResetTimer", nextTimer)
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    const timer = store.windowResetTimer
    if (timer) clearTimeout(timer)
    const historyTimer = store.historyLoadTimer
    if (historyTimer) clearTimeout(historyTimer)
  })

  createEffect(
    on(
      () => [sessionId(), renderedUserMessages().length, scrollEl()] as const,
      ([id, length, el]) => {
        if (!id) return
        if (length === 0) return
        if (store.initialScrollDone) return
        const fallback =
          el ??
          (document.querySelector('[data-scroll-container="session-pane"]') as HTMLElement | null) ??
          (document.querySelector('[data-scroll-container="session-pane-mobile"]') as HTMLElement | null)
        if (!fallback) {
          setStore("initialScrollDone", true)
          setStore("historyLoadArmed", false)
          lastScrollTop.value = 0
          return
        }
        requestAnimationFrame(() => {
          const messages = fallback.querySelectorAll("[data-message-id]")
          const last = messages[messages.length - 1] as HTMLElement | undefined
          if (!last) {
            setStore("initialScrollDone", true)
            setStore("historyLoadArmed", false)
            lastScrollTop.value = 0
            return
          }
          const target = Math.max(0, last.offsetTop + last.offsetHeight - fallback.clientHeight)
          fallback.scrollTop = target
          setStore("initialScrollDone", true)
          setStore("historyLoadArmed", false)
          lastScrollTop.value = target
        })
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const onWorktreeChange = props.onWorktreeChange
    if (!onWorktreeChange) return
    const directory = sessionDirectory()
    if (!directory) return
    const projectDir = projectDirectory()
    if (directory === projectDir) {
      if (props.worktree === undefined) return
      onWorktreeChange(undefined)
      return
    }
    if (props.worktree === directory) return
    onWorktreeChange(directory)
  })

  // Status
  const idle = { type: "idle" as const }
  const status = createMemo(() => sync.data.session_status[sessionId() ?? ""] ?? idle)
  const working = createMemo(
    () => status().type !== "idle" && sessionMessages.activeMessage()?.id === sessionMessages.lastUserMessage()?.id,
  )

  // Scroll behavior for session pane (shared between desktop and mobile)
  const scrollBehavior = useScrollBehavior(props.paneId, true)

  const [tick, setTick] = createSignal(0)
  const sessionScroll = useSessionScroll({
    working,
    composerHeight: scrollBehavior.composerHeight,
    snapRequested: scrollBehavior.snapRequested,
    clearSnapRequest: scrollBehavior.clearSnapRequest,
    onUserScrolledAway: scrollBehavior.setUserScrolledAway,
    onContentResize: () => setTick((value) => value + 1),
  })
  const mdQuery = window.matchMedia("(min-width: 768px)")
  const [isDesktop, setIsDesktop] = createSignal(mdQuery.matches)
  const handleViewportChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
  mdQuery.addEventListener("change", handleViewportChange)
  onCleanup(() => mdQuery.removeEventListener("change", handleViewportChange))

  const [desktopScrollEl, setDesktopScrollEl] = createSignal<HTMLElement | undefined>(undefined)
  const [desktopContentEl, setDesktopContentEl] = createSignal<HTMLElement | undefined>(undefined)
  const [mobileScrollEl, setMobileScrollEl] = createSignal<HTMLElement | undefined>(undefined)
  const [mobileContentEl, setMobileContentEl] = createSignal<HTMLElement | undefined>(undefined)
  const [scrollEl, setScrollEl] = createSignal<HTMLElement | undefined>(undefined)
  const [spacerEl, setSpacerEl] = createSignal<HTMLElement | undefined>(undefined)
  const [spacer, setSpacer] = createSignal(0)
  const [jumpVisible, setJumpVisible] = createSignal(false)
  const [tail, setTail] = createSignal<HTMLElement | undefined>(undefined)
  const lastScrollTop = { value: 0 }
  const jump = { frame: 0, target: undefined as HTMLElement | undefined }

  const updateJumpButton = (target?: HTMLElement) => {
    const el = target ?? scrollEl()
    if (!el) {
      setJumpVisible(false)
      return
    }
    const node = tail()
    if (!node) {
      setJumpVisible(false)
      return
    }
    if (!el.contains(node)) {
      setJumpVisible(false)
      return
    }
    const container = el.getBoundingClientRect()
    const rect = node.getBoundingClientRect()
    const distance = rect.bottom - container.bottom
    setJumpVisible(distance > MESSAGE_WINDOW_BOTTOM_THRESHOLD)
  }

  const scheduleJumpButton = (target?: HTMLElement) => {
    const el = target ?? scrollEl()
    if (!el) {
      setJumpVisible(false)
      return
    }
    jump.target = el
    if (jump.frame) return
    jump.frame = requestAnimationFrame(() => {
      const next = jump.target
      jump.frame = 0
      jump.target = undefined
      updateJumpButton(next)
    })
  }

  createEffect(() => {
    const el = scrollEl()
    const msg = sessionMessages.lastUserMessage()
    renderedUserMessages()
    if (!el || !msg) {
      setTail(undefined)
      return
    }
    const node = el.querySelector(`[data-message-id="${msg.id}"]`) as HTMLElement | null
    setTail(node ?? undefined)
  })

  onCleanup(() => {
    const frame = jump.frame
    if (frame) cancelAnimationFrame(frame)
  })

  const handleJumpToBottom = () => {
    const el = scrollEl()
    if (!el) return
    scrollBehavior.setUserScrolledAway(false)
    setJumpVisible(false)
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }

  createEffect(() => {
    const useDesktop = isDesktop()
    const scroll = useDesktop ? desktopScrollEl() : mobileScrollEl()
    const content = useDesktop ? desktopContentEl() : mobileContentEl()
    setScrollEl(scroll)
    sessionScroll.scrollRef(scroll)
    sessionScroll.contentRef(content)
  })

  createEffect(() => {
    tick()
    const el = scrollEl()
    if (!el) {
      setSpacer(0)
      return
    }
    const height = sessionScroll.containerHeight()
    if (height <= 0) {
      setSpacer(0)
      return
    }
    // Use cached tail element instead of querying all messages
    const last = tail()
    if (!last) {
      setSpacer(0)
      return
    }
    const node = spacerEl()
    const space = node && el.contains(node) ? node.offsetHeight : 0
    const head = 48
    const target = Math.max(0, last.offsetTop - head)
    const max = el.scrollHeight - space - el.clientHeight
    const need = Math.max(target - max, 0)
    const base = Math.max(height - 100, 0)
    const cap = 120
    const min = 24
    const small = Math.min(base, cap)
    const want = assistant() ? Math.max(small, min) : base
    const next = Math.max(need, want)
    setSpacer(next)
  })

  createEffect(() => {
    tick()
    spacer()
    scrollEl()
    sessionMessages.lastUserMessage()
    scheduleJumpButton()
  })

  createEffect(() => {
    const session = sessionId()
    if (!session) return

    const visible = renderedUserMessages()
    if (visible.length === 0) return

    const visibleIds = new Set(visible.map((m) => m.id))
    const messages = sync.data.message[session] ?? []
    for (const msg of messages) {
      if (msg.role === "user" && visibleIds.has(msg.id)) {
        void sync.session.ensureParts(session, msg.id)
        continue
      }

      if ("parentID" in msg && visibleIds.has(msg.parentID)) {
        void sync.session.ensureParts(session, msg.id)
      }
    }
  })

  createEffect(
    on(
      () => working(),
      (isWorking, prevWorking) => {
        if (isWorking) return
        if (!prevWorking) return
        const id = sessionMessages.lastUserMessage()?.id
        if (!id) return
        setStore("stepsExpanded", id, false)
      },
    ),
  )

  createEffect(() => {
    if (!isFocused()) return
    const id = sessionId()
    if (!id) return
    notification.session.markViewed(id)
  })

  // Session commands (only if enabled/focused)
  useSessionCommands({
    sessionId,
    viewKey,
    tabsKey: sessionKey,
    isEnabled: isFocused,
    onNavigateMessage: sessionMessages.navigateByOffset,
    onToggleSteps: () => {
      const id = sessionMessages.activeMessage()?.id
      if (!id) return
      setStore("stepsExpanded", id, (x) => !x)
    },
    onResetMessageToLast: sessionMessages.resetToLast,
    setActiveMessage: (msg) => sessionMessages.setActiveMessage(msg as UserMessage | undefined),
    userMessages: sessionMessages.userMessages,
    visibleUserMessages: sessionMessages.visibleUserMessages,
  })


  // Todo footer collapse state
  const [todoCollapsed, setTodoCollapsed] = createSignal(false)

  // Context panel state with enter/exit animation support
  const [contextPanelState, setContextPanelState] = createSignal<"closed" | "entering" | "open" | "closing">("closed")

  createEffect(
    on(
      () => activeTab() === "context",
      (isOpen, wasOpen) => {
        if (isOpen && !wasOpen) {
          // Opening - first mount in "entering" state, then transition to "open"
          setContextPanelState("entering")
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setContextPanelState("open")
            })
          })
        } else if (!isOpen && wasOpen) {
          // Closing - trigger exit animation
          setContextPanelState("closing")
          setTimeout(() => {
            setContextPanelState("closed")
          }, 200) // Match animation duration
        }
      },
    ),
  )

  const closeContextPanel = () => {
    tabs().setActive(undefined)
  }

  const handleMessageSelect = (message: UserMessage) => {
    sessionMessages.setActiveMessage(message)
    const el = scrollEl()
    if (!el) return
    const node = el.querySelector(`[data-message-id="${message.id}"]`) as HTMLElement | null
    if (!node) return
    node.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const handleScroll = (e: Event) => {
    // Handle session scroll behavior (auto-scroll, user scroll detection)
    sessionScroll.handleScroll(e)

    // Load more history when scrolled near top
    const el = e.target as HTMLElement
    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop
    const nearBottom = distanceFromBottom <= MESSAGE_WINDOW_BOTTOM_THRESHOLD
    if (nearBottom !== store.windowNearBottom) setStore("windowNearBottom", nearBottom)

    const scrolledUp = el.scrollTop + 2 < lastScrollTop.value
    if (scrolledUp && !store.historyLoadArmed) setStore("historyLoadArmed", true)
    lastScrollTop.value = el.scrollTop

    const awayFromTop = el.scrollTop > MESSAGE_WINDOW_TOP_THRESHOLD
    if (awayFromTop && !store.windowExpandArmed) setStore("windowExpandArmed", true)
    scheduleJumpButton(el)
    if (awayFromTop) return

    if (store.windowExpandArmed) {
      setStore("windowExpandArmed", false)
      setStore("windowPages", (pages) => pages + 1)
    }

    const id = sessionId()
    if (!id) return
    if (!sdkDirectoryMatches()) return
    if (!sync.session.history.more(id)) return
    if (sync.session.history.loading(id)) return
    if (!store.historyLoadArmed) return
    if (store.historyLoadLocked) return
    const historyTimer = store.historyLoadTimer
    if (historyTimer) clearTimeout(historyTimer)
    setStore("historyLoadLocked", true)
    setStore(
      "historyLoadTimer",
      setTimeout(() => {
        setStore("historyLoadLocked", false)
        setStore("historyLoadTimer", undefined)
      }, MESSAGE_HISTORY_LOAD_DEBOUNCE_MS),
    )
    void sync.session.history.loadMore(id)
  }

  // New session view
  const NewSessionView = () => (
    <div class="relative size-full flex flex-col pb-45 justify-end items-start gap-4 flex-[1_0_0] self-stretch max-w-200 mx-auto px-6">
      <div class="text-20-medium text-text-weaker">New session</div>
      <div class="flex justify-center items-center gap-3">
        <Icon name="folder" size="small" />
        <div class="text-12-medium text-text-weak">
          {getDirectory(sync.data.path.directory)}
          <span class="text-text-strong">{getFilename(sync.data.path.directory)}</span>
        </div>
      </div>
      <Show when={sync.project}>
        {(project) => (
          <div class="flex justify-center items-center gap-3">
            <Icon name="pencil-line" size="small" />
            <div class="text-12-medium text-text-weak">
              Last modified&nbsp;
              <span class="text-text-strong">
                {DateTime.fromMillis(project().time.updated ?? project().time.created).toRelative()}
              </span>
            </div>
          </div>
        )}
      </Show>
      <div class="pointer-events-none absolute inset-x-0 bottom-0 pb-6">
        <div class="pointer-events-auto mx-auto w-full max-w-200 px-6 flex justify-end">
          <ThemeDropup />
        </div>
      </div>
    </div>
  )

  // Desktop session content
  const DesktopSessionContent = () => (
    <Show when={sessionId()} fallback={<NewSessionView />}>
      <div class="relative h-full min-h-0">
        {/* Main session content - always visible */}
        <div class="flex items-stretch justify-start h-full min-h-0">
          <SessionMessageRail
            messages={sessionMessages.visibleUserMessages()}
            current={sessionMessages.activeMessage()}
            onMessageSelect={handleMessageSelect}
            wide={true}
          />
          <div
            ref={setDesktopScrollEl}
            data-scroll-container="session-pane"
            class="flex-1 min-w-0 min-h-0 overflow-y-auto no-scrollbar"
            onScroll={handleScroll}
          >
            <div ref={setDesktopContentEl} class="flex flex-col">
              <div class="flex flex-col gap-4 pt-6">

                <For each={renderedUserMessages()}>
                  {(message) => (
                    <div data-message-id={message.id} class="mb-2">
                      <SessionTurn
                        sessionID={sessionId()!}
                        messageID={message.id}
                        lastUserMessageID={sessionMessages.lastUserMessage()?.id}
                        stepsExpanded={store.stepsExpanded[message.id] ?? false}
                        todos={todos()}
                        todoCollapsed={todoCollapsed()}
                        onTodoToggle={() => setTodoCollapsed((c) => !c)}
                        onStepsExpandedToggle={() => setStore("stepsExpanded", message.id, (x) => !x)}
                        hideTitle={true}
                        actions={{
                          onEdit: messageActions.editMessage,
                          onRestore: messageActions.restoreCheckpoint,
                          onRetry: messageActions.retryMessage,
                          onDelete: messageActions.deleteMessage,
                        }}
                        classes={{
                          root: "min-w-0 w-full relative !h-auto",
                          content: "flex flex-col justify-between !overflow-visible !h-auto [&_[data-slot=session-turn-message-content]]:!mt-0",
                          container: "w-full max-w-200 mx-auto px-6",
                        }}
                      />
                    </div>
                  )}
                </For>
              </div>
              {/* Spacer to keep snap-to-top breathing room */}
              <div
                ref={setSpacerEl}
                class="shrink-0"
                style={{ height: `${spacer()}px` }}
              />
            </div>
          </div>
        </div>

        {/* Context panel overlay - slides in from right */}
        <Show when={contextPanelState() !== "closed"}>
          {/* Backdrop */}
          <div
            class="context-panel-backdrop absolute inset-0 bg-black/20 z-40"
            data-state={contextPanelState()}
            onClick={closeContextPanel}
          />
          {/* Panel */}
          <div
            class="context-panel absolute top-0 right-0 bottom-0 w-[min(400px,85%)] z-50 bg-surface-raised-stronger-non-alpha border-l border-border-base shadow-lg flex flex-col"
            data-state={contextPanelState()}
          >
            <div class="flex items-center justify-between px-4 py-3 border-b border-border-base shrink-0">
              <div class="text-14-medium text-text-strong">Context</div>
              <button
                type="button"
                class="p-1 rounded hover:bg-surface-raised-base-hover text-text-weak hover:text-text-strong"
                onClick={closeContextPanel}
              >
                <Icon name="close" size="small" />
              </button>
            </div>
            <div class="flex-1 min-h-0 overflow-hidden">
              <ContextTab
                sessionId={sessionId()!}
                sessionInfo={sessionInfo()}
              />
            </div>
          </div>
        </Show>
      </div>
    </Show>
  )

  const containerClass = "relative size-full flex flex-col overflow-hidden transition-all duration-150"
  const containerStyle = () => (hasMultiplePanes() && !isFocused() ? { opacity: 0.5 } : undefined)

  const handleMultiPaneMouseDown = (event: MouseEvent) => {
    if (!props.paneId) return
    const target = event.target as HTMLElement
    const isInteractive = target.closest('button, input, select, textarea, [contenteditable], [role="button"]')
    if (!isInteractive) {
      multiPane.setFocused(props.paneId)
    }
  }

  function setContainerRef(el: HTMLDivElement) {
    headerOverlay.containerRef(el)
    if (paneDroppable) paneDroppable.ref(el)
  }

  function setHeaderDragRef(el: HTMLDivElement) {
    if (paneDraggable) paneDraggable.ref(el)
  }

  return (
    <div
      ref={setContainerRef}
      class={containerClass}
      style={containerStyle()}
      onMouseDown={handleMultiPaneMouseDown}
      onMouseEnter={headerOverlay.handleMouseEnter}
      onMouseLeave={headerOverlay.handleMouseLeave}
      onMouseMove={headerOverlay.handleMouseMove}
    >
      <Show when={hasMultiplePanes()}>
        <div
          class="pointer-events-none absolute inset-0 z-30 border transition-opacity duration-150"
          classList={{
            "border-border-accent-base": isFocused(),
            "border-border-strong-base": !isFocused(),
            "opacity-0": multiPane.maximizedPaneId() === props.paneId,
          }}
        />
      </Show>

      {/* Header */}
      <Show when={hasMultiplePanes()}>
        <div
          ref={setHeaderDragRef}
          class="absolute top-0 left-0 right-0 z-40 transition-opacity duration-150"
          classList={{
            "opacity-100 pointer-events-auto": headerOverlay.showHeader(),
            "opacity-0 pointer-events-none": !headerOverlay.showHeader(),
            "cursor-grab": !!paneDraggable,
            "cursor-grabbing": paneDraggable?.isActiveDraggable,
          }}
          {...paneDragHandlers}
          onMouseDown={(e) => {
            // Allow right-click to bubble up to the pane grid so the radial dial
            // can open even when the cursor is over the header overlay.
            if (e.button === 2) return
            e.stopPropagation()
          }}
          onMouseEnter={() => headerOverlay.setIsOverHeader(true)}
          onMouseLeave={() => headerOverlay.setIsOverHeader(false)}
          onFocusIn={() => headerOverlay.setHeaderHasFocus(true)}
          onFocusOut={(e) => {
            const relatedTarget = e.relatedTarget as HTMLElement | null
            if (!e.currentTarget.contains(relatedTarget)) {
              headerOverlay.setHeaderHasFocus(false)
            }
          }}
        >
          <SessionPaneHeader
            paneId={props.paneId}
            directory={props.directory}
            projectDirectory={props.projectDirectory}
            sessionId={sessionId()}
            isFocused={isFocused}
            onSessionChange={props.onSessionChange}
            onDirectoryChange={props.onDirectoryChange}
            onClose={props.onClose}
          />
        </div>
      </Show>

      <div class="relative z-10 flex-1 min-h-0 flex flex-col">
        {/* Mobile view */}
        <MobileView
          sessionId={sessionId()}
          visibleUserMessages={sessionMessages.visibleUserMessages}
          lastUserMessage={sessionMessages.lastUserMessage}
          todos={todos()}
          todoCollapsed={todoCollapsed()}
          onTodoToggle={() => setTodoCollapsed((c) => !c)}
          working={working}
          composerHeight={scrollBehavior.composerHeight}
          scrollRef={setMobileScrollEl}
          contentRef={setMobileContentEl}
          onScroll={handleScroll}
          messageActions={{
            onEdit: messageActions.editMessage,
            onRestore: messageActions.restoreCheckpoint,
            onRetry: messageActions.retryMessage,
            onDelete: messageActions.deleteMessage,
          }}
          newSessionView={NewSessionView}
        />

        {/* Desktop view */}
        <div class="flex-1 min-h-0 flex">
          <div class="@container relative shrink-0 py-3 flex flex-col gap-6 min-h-0 h-full w-full">
            <div class="flex-1 min-h-0 overflow-hidden">
              <DesktopSessionContent />
            </div>
          </div>
        </div>
      </div>

      <Show when={jumpVisible()}>
        <div class="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 md:bottom-6 z-30">
          <button
            type="button"
            aria-label="Jump to bottom"
            class="pointer-events-auto flex items-center justify-center rounded-full border border-border-strong-base p-2 text-text-base shadow-sm transition-colors"
            onClick={handleJumpToBottom}
          >
            <Icon name="chevron-down" size="small" />
          </button>
        </div>
      </Show>

    </div>
  )
}

export { SessionPaneHeader } from "./header"
export { ContextTab } from "./context-tab"
export { MobileView } from "./mobile-view"

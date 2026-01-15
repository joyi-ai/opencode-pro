import { Show, For, Switch, Match, createMemo, createEffect, on, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import type { Message } from "@opencode-ai/sdk/v2/client"

export interface MobileViewProps {
  sessionId?: string
  visibleUserMessages: Accessor<UserMessage[]>
  lastUserMessage: Accessor<UserMessage | undefined>
  working: Accessor<boolean>
  onUserInteracted?: () => void
  messageActions?: {
    onEdit?: (message: Message) => void
    onRestore?: (message: Message) => void
    onRetry?: (message: Message) => void
    onDelete?: (message: Message) => void
  }
  newSessionView: () => any
}

export function MobileView(props: MobileViewProps) {

  const [store, setStore] = createStore({
    mobileStepsExpanded: {} as Record<string, boolean>,
    userInteracted: false,
    pendingTopScrollId: undefined as string | undefined,
    pendingTopScrollCanceled: false,
    pendingTopScrollFrame: undefined as number | undefined,
  })

  const mobileAutoScroll = createAutoScroll({
    working: props.working,
    onUserInteracted: () => {
      setStore("userInteracted", true)
      props.onUserInteracted?.()
    },
  })

  const handleUserScrollIntent = () => {
    if (!store.pendingTopScrollId) return
    setStore("pendingTopScrollCanceled", true)
  }

  let scrollIntentCleanup: (() => void) | undefined
  let mobileScrollEl: HTMLDivElement | undefined

  const setMobileScrollRef = (el: HTMLDivElement | undefined) => {
    if (scrollIntentCleanup) {
      scrollIntentCleanup()
      scrollIntentCleanup = undefined
    }

    mobileScrollEl = el
    mobileAutoScroll.scrollRef(el)
    if (!el) return

    el.addEventListener("wheel", handleUserScrollIntent, { passive: true })
    el.addEventListener("pointerdown", handleUserScrollIntent)
    el.addEventListener("touchstart", handleUserScrollIntent, { passive: true })

    scrollIntentCleanup = () => {
      el.removeEventListener("wheel", handleUserScrollIntent)
      el.removeEventListener("pointerdown", handleUserScrollIntent)
      el.removeEventListener("touchstart", handleUserScrollIntent)
    }
  }

  onCleanup(() => {
    if (scrollIntentCleanup) scrollIntentCleanup()

    const pending = store.pendingTopScrollFrame
    if (!pending) return
    cancelAnimationFrame(pending)
  })

  const scrollToMessage = (
    id: string,
    behavior: ScrollBehavior = "smooth",
    block: ScrollLogicalPosition = "center",
  ) => {
    const root = mobileScrollEl
    if (!root) return

    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(id) : id.replaceAll('"', '\\"')

    const el = root.querySelector(`[data-message="${escaped}"]`) as HTMLElement | null
    if (!el) return
    el.scrollIntoView({ block, behavior })
  }

  const scheduleScrollToMessageTop = (id: string) => {
    if (!mobileScrollEl) return

    const pending = store.pendingTopScrollFrame
    if (pending) cancelAnimationFrame(pending)

    setStore({
      pendingTopScrollId: id,
      pendingTopScrollCanceled: false,
      pendingTopScrollFrame: undefined,
    })

    const frame = requestAnimationFrame(() => {
      if (store.pendingTopScrollId !== id) return

      if (store.pendingTopScrollCanceled) {
        setStore({
          pendingTopScrollId: undefined,
          pendingTopScrollCanceled: false,
          pendingTopScrollFrame: undefined,
        })
        return
      }

      scrollToMessage(id, "smooth", "start")
      mobileAutoScroll.handleInteraction()
      setStore({
        pendingTopScrollId: undefined,
        pendingTopScrollCanceled: false,
        pendingTopScrollFrame: undefined,
      })
    })

    setStore("pendingTopScrollFrame", frame)
  }

  createEffect(
    on(
      () => props.visibleUserMessages().at(-1)?.id,
      (lastId, prevLastId) => {
        if (!lastId) return
        if (!prevLastId) return
        if (lastId <= prevLastId) return
        scheduleScrollToMessageTop(lastId)
      },
      { defer: true },
    ),
  )

  const MobileTurns = () => (
    <div
      ref={setMobileScrollRef}
      onScroll={mobileAutoScroll.handleScroll}
      onClick={mobileAutoScroll.handleInteraction}
      class="relative mt-2 min-w-0 w-full h-full overflow-y-auto no-scrollbar pb-12"
    >
      <div ref={mobileAutoScroll.contentRef} class="flex flex-col gap-4 items-start justify-start mt-4">
        <For each={props.visibleUserMessages()}>
          {(message) => (
            <SessionTurn
              sessionID={props.sessionId!}
              messageID={message.id}
              lastUserMessageID={props.lastUserMessage()?.id}
              stepsExpanded={store.mobileStepsExpanded[message.id] ?? false}
              onStepsExpandedToggle={() => setStore("mobileStepsExpanded", message.id, (x) => !x)}
              hideTitle={true}
              onUserInteracted={() => {
                setStore("userInteracted", true)
                props.onUserInteracted?.()
              }}
              actions={props.messageActions}
              classes={{
                root: "min-w-0 w-full relative",
                content:
                  "flex flex-col justify-between !overflow-visible [&_[data-slot=session-turn-message-header]]:top-[-32px] [&_[data-slot=session-turn-message-content]]:!mt-0",
                container: "px-4",
              }}
            />
          )}
        </For>
      </div>
    </div>
  )

  return (
    <div class="md:hidden flex-1 min-h-0 flex flex-col bg-background-stronger">
      <Show when={props.sessionId} fallback={<div class="flex-1 min-h-0 overflow-hidden">{props.newSessionView()}</div>}>
        <div class="flex-1 min-h-0 overflow-hidden">
          <MobileTurns />
        </div>
      </Show>
    </div>
  )
}

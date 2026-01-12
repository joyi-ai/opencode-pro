import { Show, For, Switch, Match, createMemo, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { Tabs } from "@opencode-ai/ui/tabs"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { SessionReview } from "@opencode-ai/ui/session-review"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { useLayout } from "@/context/layout"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import type { FileDiff } from "@opencode-ai/sdk/v2"
import type { Message } from "@opencode-ai/sdk/v2/client"

export interface MobileViewProps {
  sessionId?: string
  visibleUserMessages: Accessor<UserMessage[]>
  lastUserMessage: Accessor<UserMessage | undefined>
  diffs: Accessor<FileDiff[]>
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
  const layout = useLayout()

  const [store, setStore] = createStore({
    mobileStepsExpanded: {} as Record<string, boolean>,
    userInteracted: false,
  })

  const mobileAutoScroll = createAutoScroll({
    working: props.working,
    onUserInteracted: () => {
      setStore("userInteracted", true)
      props.onUserInteracted?.()
    },
  })

  const MobileTurns = () => (
    <div
      ref={mobileAutoScroll.scrollRef}
      onScroll={mobileAutoScroll.handleScroll}
      onClick={mobileAutoScroll.handleInteraction}
      class="relative mt-2 min-w-0 w-full h-full overflow-y-auto no-scrollbar pb-12"
    >
      <div ref={mobileAutoScroll.contentRef} class="flex flex-col gap-45 items-start justify-start mt-4">
        <For each={props.visibleUserMessages()}>
          {(message) => (
            <SessionTurn
              sessionID={props.sessionId!}
              messageID={message.id}
              lastUserMessageID={props.lastUserMessage()?.id}
              stepsExpanded={store.mobileStepsExpanded[message.id] ?? false}
              onStepsExpandedToggle={() => setStore("mobileStepsExpanded", message.id, (x) => !x)}
              onUserInteracted={() => {
                setStore("userInteracted", true)
                props.onUserInteracted?.()
              }}
              actions={props.messageActions}
              classes={{
                root: "min-w-0 w-full relative",
                content:
                  "flex flex-col justify-between !overflow-visible [&_[data-slot=session-turn-message-header]]:top-[-32px]",
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
      <Switch>
        <Match when={!props.sessionId}>
          <div class="flex-1 min-h-0 overflow-hidden">{props.newSessionView()}</div>
        </Match>
        <Match when={props.diffs().length > 0}>
          <Tabs class="flex-1 min-h-0 flex flex-col pb-28">
            <Tabs.List>
              <Tabs.Trigger value="session" class="w-1/2" classes={{ button: "w-full" }}>
                Session
              </Tabs.Trigger>
              <Tabs.Trigger value="review" class="w-1/2 !border-r-0" classes={{ button: "w-full" }}>
                {props.diffs().length} Files Changed
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="session" class="flex-1 !overflow-hidden">
              <MobileTurns />
            </Tabs.Content>
            <Tabs.Content forceMount value="review" class="flex-1 !overflow-hidden hidden data-[selected]:block">
              <div class="relative h-full mt-6 overflow-y-auto no-scrollbar">
                <SessionReview
                  diffs={props.diffs()}
                  diffStyle={layout.review.diffStyle()}
                  onDiffStyleChange={layout.review.setDiffStyle}
                  classes={{
                    root: "pb-32",
                    header: "px-4",
                    container: "px-4",
                  }}
                />
              </div>
            </Tabs.Content>
          </Tabs>
        </Match>
        <Match when={true}>
          <div class="flex-1 min-h-0 overflow-hidden">
            <MobileTurns />
          </div>
        </Match>
      </Switch>
    </div>
  )
}

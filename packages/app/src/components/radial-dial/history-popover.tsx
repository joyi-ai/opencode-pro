import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { DateTime } from "luxon"
import { useGlobalSync } from "@/context/global-sync"
import { useNotification } from "@/context/notification"
import { normalizeDirectoryKey } from "@/utils/directory"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Button } from "@opencode-ai/ui/button"
import type { Session } from "@opencode-ai/sdk/v2/client"

interface HistoryPopoverProps {
  x: number
  y: number
  directory: string
  worktree?: string
  onSessionSelect: (sessionId: string) => void
  onClose: () => void
}

function sameDirectory(a: string | undefined, b: string | undefined) {
  return normalizeDirectoryKey(a) === normalizeDirectoryKey(b)
}

function sortSessions(a: Session, b: Session) {
  const now = Date.now()
  const oneMinuteAgo = now - 60 * 1000
  const aUpdated = a.time.updated ?? a.time.created
  const bUpdated = b.time.updated ?? b.time.created
  const aRecent = aUpdated > oneMinuteAgo
  const bRecent = bUpdated > oneMinuteAgo
  if (aRecent && bRecent) return a.id.localeCompare(b.id)
  if (aRecent && !bRecent) return -1
  if (!aRecent && bRecent) return 1
  return bUpdated - aUpdated
}

function SessionItem(props: {
  session: Session
  directory: string
  onSelect: (sessionId: string) => void
}) {
  const notification = useNotification()
  const globalSync = useGlobalSync()
  const [relative, setRelative] = createSignal("")

  const formatRelative = (value: number | undefined) => {
    if (!value) return ""
    const valueTime = DateTime.fromMillis(value)
    const raw =
      Math.abs(valueTime.diffNow().as("seconds")) < 60
        ? "Now"
        : valueTime.toRelative({
            style: "short",
            unit: ["days", "hours", "minutes"],
          })
    if (!raw) return ""
    return raw.replace(" ago", "").replace(/ days?/, "d").replace(" min.", "m").replace(" hr.", "h")
  }

  createEffect(() => {
    const value = props.session.time.updated ?? props.session.time.created
    setRelative(formatRelative(value))
    const timer = setInterval(() => setRelative(formatRelative(value)), 60_000)
    onCleanup(() => clearInterval(timer))
  })

  const notifications = createMemo(() => notification.session.unseen(props.session.id))
  const hasError = createMemo(() => notifications().some((n) => n.type === "error"))
  const [sessionStore] = globalSync.child(props.directory)

  const hasPermissions = createMemo(() => {
    const permissions = sessionStore.permission?.[props.session.id] ?? []
    if (permissions.length > 0) return true
    const childSessions = sessionStore.session.filter((s) => s.parentID === props.session.id)
    for (const child of childSessions) {
      const childPermissions = sessionStore.permission?.[child.id] ?? []
      if (childPermissions.length > 0) return true
    }
    return false
  })

  const isWorking = createMemo(() => {
    if (hasPermissions()) return false
    const status = sessionStore.session_status[props.session.id]
    return status?.type === "busy" || status?.type === "retry"
  })

  return (
    <div
      data-session-id={props.session.id}
      class="group/session relative w-full pr-2 py-1.5 rounded-md cursor-pointer transition-colors hover:bg-surface-raised-base-hover"
      style={{ "padding-left": "12px" }}
      onClick={() => props.onSelect(props.session.id)}
    >
      <Tooltip placement="right" value={props.session.title} gutter={10}>
        <div class="flex flex-col min-w-0 text-left w-full">
          <div class="flex items-center self-stretch gap-4 justify-between">
            <span
              classList={{
                "text-13-regular text-text-strong overflow-hidden text-ellipsis truncate": true,
                "animate-pulse": isWorking(),
              }}
            >
              {props.session.title}
            </span>
            <div class="shrink-0">
              <Show when={isWorking()}>
                <Spinner class="size-2.5 mr-0.5" />
              </Show>
              <Show when={!isWorking() && hasPermissions()}>
                <div class="size-1.5 mr-1.5 rounded-full bg-surface-warning-strong" />
              </Show>
              <Show when={!isWorking() && !hasPermissions() && hasError()}>
                <div class="size-1.5 mr-1.5 rounded-full bg-text-diff-delete-base" />
              </Show>
              <Show when={!isWorking() && !hasPermissions() && !hasError() && notifications().length > 0}>
                <div class="size-1.5 mr-1.5 rounded-full bg-text-interactive-base" />
              </Show>
              <Show when={!isWorking() && !hasPermissions() && !hasError() && notifications().length === 0}>
                <span class="text-11-regular text-text-weak text-right whitespace-nowrap">{relative()}</span>
              </Show>
            </div>
          </div>
          <Show when={props.session.summary?.files}>
            <div class="flex justify-between items-center self-stretch">
              <span class="text-11-regular text-text-weak">{`${props.session.summary?.files || "No"} file${props.session.summary?.files !== 1 ? "s" : ""} changed`}</span>
              <Show when={props.session.summary}>{(summary) => <DiffChanges changes={summary()} />}</Show>
            </div>
          </Show>
        </div>
      </Tooltip>
    </div>
  )
}

export function HistoryPopover(props: HistoryPopoverProps) {
  const globalSync = useGlobalSync()
  let contentRef: HTMLDivElement | undefined

  const directory = createMemo(() => props.worktree ?? props.directory)
  const [store, setProjectStore] = globalSync.child(directory())

  const sessions = createMemo(() =>
    store.session
      .filter((s) => !s.parentID && !s.time?.archived && sameDirectory(s.directory, directory()))
      .toSorted(sortSessions),
  )

  const hasMoreSessions = createMemo(() => store.session_more ?? store.session.length >= store.limit)

  const loadMoreSessions = async () => {
    setProjectStore("limit", (limit) => limit + 5)
    await globalSync.project.loadSessions(directory())
  }

  createEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (contentRef?.contains(target)) return
      props.onClose()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        props.onClose()
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleKeyDown)
    onCleanup(() => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleKeyDown)
    })
  })

  return (
    <div
      ref={contentRef}
      class="fixed z-50 w-72 max-h-96 overflow-y-auto rounded-lg border border-border-base bg-background-base shadow-lg p-2 animate-in fade-in-0 zoom-in-95"
      style={{
        right: `calc(100vw - ${props.x}px + 8px)`,
        top: `${props.y - 100}px`,
      }}
    >
      <div class="flex items-center gap-2 px-2 py-1.5 mb-1">
        <Icon name="history" size="small" class="text-icon-base" />
        <span class="text-12-medium text-text-base">Session History</span>
      </div>
      <div class="flex flex-col gap-1">
        <For each={sessions()}>
          {(session) => (
            <SessionItem session={session} directory={directory()} onSelect={props.onSessionSelect} />
          )}
        </For>
      </div>
      <Show when={sessions().length === 0}>
        <div class="px-3 py-2 text-13-regular text-text-weak">No sessions</div>
      </Show>
      <Show when={hasMoreSessions()}>
        <Button
          variant="ghost"
          class="w-full text-left justify-start text-11-medium opacity-60 px-3"
          size="small"
          onClick={loadMoreSessions}
        >
          Load more
        </Button>
      </Show>
    </div>
  )
}

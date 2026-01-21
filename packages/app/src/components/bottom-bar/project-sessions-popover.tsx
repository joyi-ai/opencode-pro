import { createEffect, createMemo, createSignal, For, onCleanup, Show, type ParentProps } from "solid-js"
import { A, useParams, useNavigate } from "@solidjs/router"
import { DateTime } from "luxon"
import { Popover as Kobalte } from "@kobalte/core/popover"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useNotification } from "@/context/notification"
import { useLayout, type LocalProject } from "@/context/layout"
import { base64Decode, base64Encode } from "@opencode-ai/util/encode"
import { getFilename } from "@opencode-ai/util/path"
import { normalizeDirectoryKey } from "@/utils/directory"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Button } from "@opencode-ai/ui/button"
import { createOpencodeClient, type Session } from "@opencode-ai/sdk/v2/client"
import { usePlatform } from "@/context/platform"

type Props = ParentProps<{
  project: LocalProject
}>

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

function SessionItem(props: { session: Session; directory: string; onArchive?: (sessionID: string) => void; archived?: boolean }) {
  const params = useParams()
  const notification = useNotification()
  const globalSync = useGlobalSync()
  const globalSdk = useGlobalSDK()
  const platform = usePlatform()
  const navigate = useNavigate()
  const [relative, setRelative] = createSignal("")
  const [archiving, setArchiving] = createSignal(false)

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
    if (props.session.id === params.id) return false
    if (hasPermissions()) return false
    const status = sessionStore.session_status[props.session.id]
    return status?.type === "busy" || status?.type === "retry"
  })

  const isActive = createMemo(() => {
    if (!params.dir || !params.id) return false
    if (params.id !== props.session.id) return false
    const currentDir = base64Decode(params.dir)
    return sameDirectory(currentDir, props.directory)
  })

  const sessionHref = createMemo(() => `/${base64Encode(props.directory)}/session/${props.session.id}`)

  const archiveSession = async (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (archiving()) return
    setArchiving(true)
    const sdk = createOpencodeClient({
      baseUrl: globalSdk.url,
      directory: props.directory,
      fetch: platform.fetch,
    })
    await sdk.session.update({
      sessionID: props.session.id,
      time: { archived: Date.now() },
    })
    setArchiving(false)
    props.onArchive?.(props.session.id)
    if (isActive()) {
      navigate(`/${base64Encode(props.directory)}/session`)
    }
  }

  const unarchiveSession = async (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (archiving()) return
    setArchiving(true)
    const sdk = createOpencodeClient({
      baseUrl: globalSdk.url,
      directory: props.directory,
      fetch: platform.fetch,
    })
    await sdk.session.update({
      sessionID: props.session.id,
      time: { archived: 0 },
    })
    setArchiving(false)
    props.onArchive?.(props.session.id)
  }

  return (
    <div
      data-session-id={props.session.id}
      class="group/session relative w-full pr-2 py-1.5 rounded-md cursor-default transition-colors hover:bg-surface-raised-base-hover"
      style={{ "padding-left": "12px" }}
      classList={{ "bg-surface-raised-base-hover": isActive() }}
    >
      <Tooltip placement="right" value={props.session.title} gutter={10}>
        <A href={sessionHref()} class="flex flex-col min-w-0 text-left w-full focus:outline-none" activeClass="">
          <div class="flex items-center self-stretch gap-4 justify-between">
            <span
              classList={{
                "text-13-regular text-text-strong overflow-hidden text-ellipsis truncate": true,
                "animate-pulse": isWorking(),
              }}
            >
              {props.session.title}
            </span>
            <div class="shrink-0 flex items-center gap-1">
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
                <div class="relative flex items-center justify-end min-w-5 h-5">
                  <span class="text-11-regular text-text-weak text-right whitespace-nowrap group-hover/session:opacity-0">{relative()}</span>
                  <Show when={props.archived}>
                    <Tooltip placement="top" value="Unarchive session">
                      <button
                        type="button"
                        onClick={unarchiveSession}
                        class="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover/session:opacity-100 flex items-center justify-center size-5 rounded hover:bg-surface-raised-base-active"
                        disabled={archiving()}
                      >
                        <Show when={archiving()} fallback={<Icon name="revert" size="small" class="text-icon-base" />}>
                          <Spinner class="size-2.5" />
                        </Show>
                      </button>
                    </Tooltip>
                  </Show>
                  <Show when={!props.archived}>
                    <Tooltip placement="top" value="Archive session">
                      <button
                        type="button"
                        onClick={archiveSession}
                        class="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover/session:opacity-100 flex items-center justify-center size-5 rounded hover:bg-surface-raised-base-active"
                        disabled={archiving()}
                      >
                        <Show when={archiving()} fallback={<Icon name="archive" size="small" class="text-icon-base" />}>
                          <Spinner class="size-2.5" />
                        </Show>
                      </button>
                    </Tooltip>
                  </Show>
                </div>
              </Show>
            </div>
          </div>
          <Show when={props.session.summary?.files}>
            <div class="flex justify-between items-center self-stretch">
              <span class="text-11-regular text-text-weak">{`${props.session.summary?.files || "No"} file${props.session.summary?.files !== 1 ? "s" : ""} changed`}</span>
              <Show when={props.session.summary}>{(summary) => <DiffChanges changes={summary()} />}</Show>
            </div>
          </Show>
        </A>
      </Tooltip>
    </div>
  )
}

type TabInfo = {
  id: string
  directory: string
  label: string
  isArchived: boolean
}

function SessionsList(props: {
  directory: string
  isArchived: boolean
  onArchiveChange: () => void
}) {
  const globalSync = useGlobalSync()
  const globalSdk = useGlobalSDK()
  const platform = usePlatform()
  const [store, setProjectStore] = globalSync.child(props.directory)
  const [archivedSessions, setArchivedSessions] = createSignal<Session[]>([])
  const [loadingArchived, setLoadingArchived] = createSignal(false)
  const [archivedLoaded, setArchivedLoaded] = createSignal(false)

  const activeSessions = createMemo(() =>
    store.session
      .filter((s) => !s.parentID && !s.time?.archived && sameDirectory(s.directory, props.directory))
      .toSorted(sortSessions),
  )

  const hasMoreSessions = createMemo(() => store.session_more ?? store.session.length >= store.limit)

  const loadMoreSessions = async () => {
    setProjectStore("limit", (limit) => limit + 5)
    await globalSync.project.loadSessions(props.directory)
  }

  const loadArchivedSessions = async () => {
    if (archivedLoaded() || loadingArchived()) return
    setLoadingArchived(true)
    const sdk = createOpencodeClient({
      baseUrl: globalSdk.url,
      directory: props.directory,
      fetch: platform.fetch,
    })
    const response = await sdk.session.list({ limit: 100 })
    const archived = (response.data ?? [])
      .filter((s) => s.time?.archived && !s.parentID && sameDirectory(s.directory, props.directory))
      .toSorted(sortSessions)
    setArchivedSessions(archived)
    setLoadingArchived(false)
    setArchivedLoaded(true)
  }

  createEffect(() => {
    if (props.isArchived && !archivedLoaded()) {
      loadArchivedSessions()
    }
  })

  const handleArchiveChange = () => {
    setArchivedLoaded(false)
    props.onArchiveChange()
    if (props.isArchived) {
      loadArchivedSessions()
    }
  }

  const newSessionHref = createMemo(() => `/${base64Encode(props.directory)}/session`)

  return (
    <Show
      when={!props.isArchived}
      fallback={
        <>
          <Show when={loadingArchived()}>
            <div class="flex items-center justify-center py-4">
              <Spinner class="size-4" />
            </div>
          </Show>
          <Show when={!loadingArchived() && archivedSessions().length === 0}>
            <div class="px-3 py-4 text-12-regular text-text-weak text-center">No archived sessions</div>
          </Show>
          <Show when={!loadingArchived() && archivedSessions().length > 0}>
            <div class="flex flex-col gap-1">
              <For each={archivedSessions()}>
                {(session) => (
                  <SessionItem session={session} directory={props.directory} archived onArchive={handleArchiveChange} />
                )}
              </For>
            </div>
          </Show>
        </>
      }
    >
      <div class="flex flex-col gap-1">
        <For each={activeSessions()}>
          {(session) => <SessionItem session={session} directory={props.directory} onArchive={handleArchiveChange} />}
        </For>
      </div>
      <Show when={activeSessions().length === 0}>
        <A
          href={newSessionHref()}
          class="block w-full px-3 py-4 text-12-regular text-text-weak hover:bg-surface-raised-base-hover rounded-md text-center"
        >
          New session
        </A>
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
    </Show>
  )
}

export function ProjectSessionsPopover(props: Props) {
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const navigate = useNavigate()
  const params = useParams()
  const [open, setOpen] = createSignal(false)
  const [confirmRemove, setConfirmRemove] = createSignal(false)
  const [activeTab, setActiveTab] = createSignal<string>("main")
  const [archiveRefreshKey, setArchiveRefreshKey] = createSignal(0)
  let contentRef: HTMLDivElement | undefined
  let triggerRef: HTMLDivElement | undefined

  // Sync activeTab with current route directory when popover opens
  createEffect(() => {
    if (!open()) return
    const currentDir = params.dir ? base64Decode(params.dir) : undefined
    if (!currentDir) return
    // Check if current directory belongs to this project
    if (sameDirectory(currentDir, props.project.worktree)) {
      setActiveTab("main")
      return
    }
    // Check if current directory is one of this project's sandboxes
    const sandboxes = props.project.sandboxes ?? []
    for (const sandbox of sandboxes) {
      if (sameDirectory(currentDir, sandbox)) {
        setActiveTab(`worktree-${sandbox}`)
        return
      }
    }
  })

  const handleCloseProject = () => {
    if (!confirmRemove()) {
      setConfirmRemove(true)
      return
    }
    const currentDir = params.dir ? base64Decode(params.dir) : undefined
    const isSameProject = sameDirectory(currentDir, props.project.worktree)
    layout.projects.close(props.project.worktree)
    setOpen(false)
    setConfirmRemove(false)
    if (isSameProject) {
      const otherProjects = layout.projects.list().filter((p) => !sameDirectory(p.worktree, props.project.worktree))
      if (otherProjects.length > 0) {
        navigate(`/${base64Encode(otherProjects[0].worktree)}/session`)
      } else {
        navigate("/")
      }
    }
  }

  const tabs = createMemo(() => {
    const result: TabInfo[] = []
    // Main worktree tab
    result.push({
      id: "main",
      directory: props.project.worktree,
      label: "main",
      isArchived: false,
    })
    // Sandbox worktree tabs
    const sandboxes = (props.project.sandboxes ?? []).filter((dir) => {
      const [store] = globalSync.child(dir)
      return store.session.some((s) => sameDirectory(s.directory, dir))
    })
    for (const dir of sandboxes) {
      result.push({
        id: `worktree-${dir}`,
        directory: dir,
        label: getFilename(dir),
        isArchived: false,
      })
    }
    // Archived tab
    result.push({
      id: "archived",
      directory: props.project.worktree,
      label: "Archived",
      isArchived: true,
    })
    return result
  })

  const currentTab = createMemo(() => {
    const tab = tabs().find((t) => t.id === activeTab())
    return tab ?? tabs()[0]
  })

  createEffect(() => {
    if (!open()) {
      setConfirmRemove(false)
      return
    }
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (contentRef?.contains(target)) return
      if (triggerRef?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("click", handleClickOutside)
    onCleanup(() => document.removeEventListener("click", handleClickOutside))
  })

  const handleArchiveChange = () => {
    setArchiveRefreshKey((k) => k + 1)
  }

  return (
    <Kobalte gutter={8} placement="top-start" open={open()} onOpenChange={setOpen}>
      <Kobalte.Trigger as="div" class="cursor-pointer" ref={triggerRef}>
        {props.children}
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content ref={contentRef} class="z-50 w-80 rounded-lg border border-border-base bg-background-base shadow-lg p-3 animate-in fade-in-0 zoom-in-95">
          {/* Tabs with actions */}
          <div class="flex items-center gap-1 pb-2 mb-2 border-b border-border-weak-base">
            <div class="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1">
              <For each={tabs()}>
                {(tab) => (
                  <button
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    class="px-2 py-1 rounded-md text-11-medium whitespace-nowrap transition-colors flex items-center"
                    classList={{
                      "bg-surface-raised-base-hover text-text-strong": activeTab() === tab.id,
                      "text-text-weak hover:text-text-base hover:bg-surface-raised-base-hover": activeTab() !== tab.id,
                    }}
                  >
                    <Show when={tab.isArchived} fallback={tab.label}>
                      <Icon name="archive" class="text-icon-weak size-3" />
                    </Show>
                  </button>
                )}
              </For>
            </div>
            <Tooltip placement="top" value={confirmRemove() ? "Click again to confirm" : "Remove project from sidebar"}>
              <IconButton
                icon="trash"
                variant="ghost"
                onClick={handleCloseProject}
                class={confirmRemove() ? "text-text-critical-base" : ""}
              />
            </Tooltip>
          </div>
          {/* Session list for current tab */}
          <div class="max-h-72 overflow-y-auto no-scrollbar">
            <Show when={currentTab()}>
              {(tab) => (
                <SessionsList
                  directory={tab().directory}
                  isArchived={tab().isArchived}
                  onArchiveChange={handleArchiveChange}
                />
              )}
            </Show>
          </div>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}

import { createMemo, createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { HomeContent } from "@/components/home-content"
import { PromptInput } from "@/components/prompt-input"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"
import { TerminalProvider } from "@/context/terminal"
import { PromptProvider } from "@/context/prompt"
import { FileProvider } from "@/context/file"
import { DataProvider } from "@opencode-ai/ui/context"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { useGlobalSDK } from "@/context/global-sdk"
import { showToast } from "@opencode-ai/ui/toast"

export interface HomePromptBarProps {
  directory: string
  onSessionCreated?: (sessionId: string) => void
}

export function HomePromptBar(props: HomePromptBarProps) {
  return (
    <SDKProvider directory={props.directory}>
      <SyncProvider>
        <SyncedHomePrompt directory={props.directory} onSessionCreated={props.onSessionCreated} />
      </SyncProvider>
    </SDKProvider>
  )
}

function SyncedHomePrompt(props: HomePromptBarProps) {
  const sync = useSync()

  return (
    <DataProvider data={sync.data} directory={props.directory} onPermissionRespond={() => Promise.resolve()}>
      <LocalProvider>
        <TerminalProvider>
          <FileProvider>
            <PromptProvider>
              <div class="w-full max-w-200 mx-auto px-6 pb-8">
                <PromptInput onSessionCreated={props.onSessionCreated} />
              </div>
            </PromptProvider>
          </FileProvider>
        </TerminalProvider>
      </LocalProvider>
    </DataProvider>
  )
}

export interface HomeScreenProps {
  selectedProject?: string
  currentWorktree?: string
  hideLogo?: boolean
  onNavigateMulti?: () => void
  onProjectSelected?: (directory: string) => void
  onWorktreeSelected?: (worktree: string | undefined) => void
  onCreateWorktree?: () => Promise<string | undefined> | string | undefined
  showRelativeTime?: boolean
  showThemePicker?: boolean
}

export function HomeScreen(props: HomeScreenProps) {
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const [state, setState] = createStore<{ project?: string; worktree?: string }>({
    project: undefined,
    worktree: undefined,
  })

  const mostRecent = createMemo(() => {
    const sorted = globalSync.data.project.toSorted(
      (a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created),
    )
    return sorted[0]?.worktree
  })
  const defaultDirectory = createMemo(() => globalSync.data.path.directory)
  const preferredProject = createMemo(() => mostRecent() || defaultDirectory())

  createEffect(() => {
    if (props.selectedProject !== undefined) return
    if (state.project !== undefined) return
    const candidate = preferredProject()
    if (!candidate) return
    setState("project", candidate)
  })

  const effectiveProject = createMemo(() => props.selectedProject ?? state.project)
  const effectiveWorktree = createMemo(() => props.currentWorktree ?? state.worktree)

  function handleSelectProject(directory: string) {
    if (props.selectedProject === undefined) {
      setState("project", directory)
    }
    if (props.currentWorktree === undefined) {
      setState("worktree", undefined)
    }
    props.onWorktreeSelected?.(undefined)
    layout.projects.open(directory)
    props.onProjectSelected?.(directory)
  }

  function handleSelectWorktree(worktree: string | undefined) {
    if (props.currentWorktree === undefined) {
      setState("worktree", worktree)
    }
    props.onWorktreeSelected?.(worktree)
  }

  async function handleCreateWorktree() {
    if (props.onCreateWorktree) return props.onCreateWorktree()
    const directory = effectiveProject()
    if (!directory) {
      showToast({
        variant: "error",
        title: "Select a project first",
        description: "Choose a project before creating a worktree.",
      })
      return undefined
    }
    const created = await globalSDK.client.worktree
      .create({ directory })
      .then((result) => result.data)
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to create worktree."
        showToast({
          variant: "error",
          title: "Failed to create worktree",
          description: message,
        })
        return undefined
      })
    return created?.directory
  }

  async function handleDeleteWorktree(worktree: string) {
    // Use the global worktree delete endpoint which doesn't require Instance context
    const url = new URL("/global/worktree", globalSDK.url)
    url.searchParams.set("directory", worktree)
    try {
      const res = await fetch(url.toString(), { method: "DELETE" })
      if (!res.ok) {
        const text = await res.text().catch(() => "Unknown error")
        throw new Error(text || "Failed to delete worktree.")
      }
      // If the deleted worktree was selected, clear the selection
      if (effectiveWorktree() === worktree) {
        handleSelectWorktree(undefined)
      }
      showToast({
        variant: "success",
        title: "Worktree deleted",
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete worktree."
      showToast({
        variant: "error",
        title: "Failed to delete worktree",
        description: message,
      })
      throw error
    }
  }

  return (
    <div class="flex-1 min-h-0 flex flex-col">
      <HomeContent
        variant="page"
        selectedProject={effectiveProject()}
        currentWorktree={effectiveWorktree()}
        hideLogo={props.hideLogo}
        onSelectProject={handleSelectProject}
        onSelectWorktree={handleSelectWorktree}
        onCreateWorktree={handleCreateWorktree}
        onDeleteWorktree={handleDeleteWorktree}
        onNavigateMulti={props.onNavigateMulti}
        showRelativeTime={props.showRelativeTime}
        showThemePicker={props.showThemePicker}
      />
    </div>
  )
}

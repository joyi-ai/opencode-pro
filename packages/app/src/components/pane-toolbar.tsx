import { Show, createMemo } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { showToast } from "@opencode-ai/ui/toast"
import { useMultiPane } from "@/context/multi-pane"
import { useLayout } from "@/context/layout"

export function PaneToolbar() {
  const multiPane = useMultiPane()
  const layout = useLayout()

  const currentPage = createMemo(() => multiPane.currentPage() + 1)
  const totalPages = createMemo(() => multiPane.totalPages())
  const paneCount = createMemo(() => multiPane.panes().length)

  function handleAddPane() {
    const focusedPane = multiPane.focusedPane()
    // Use focused pane's directory, or fall back to most recent project
    const directory = focusedPane?.directory ?? layout.projects.list()[0]?.worktree
    const id = multiPane.addPane(directory)
    if (!id) {
      showToast({
        title: "Tab limit reached",
        description: "Maximum of 48 tabs allowed",
      })
    }
  }

  function handleRemovePane() {
    const focused = multiPane.focusedPaneId()
    if (focused) {
      multiPane.removePane(focused)
    }
  }

  return (
    <div class="h-8 shrink-0 bg-background-base border-b border-border-weak-base flex items-center justify-between px-2 gap-2">
      <div class="flex items-center gap-2">
        <div class="text-13-medium text-text-strong">Multi-Session</div>
      </div>

      <div class="flex items-center gap-2">
        <Tooltip value="New Tab">
          <Button size="normal" variant="ghost" onClick={handleAddPane}>
            <Icon name="plus" size="small" />
            <span>New Tab</span>
          </Button>
        </Tooltip>
        <Show when={paneCount() > 1}>
          <Tooltip value="Close focused tab">
            <IconButton icon="close" variant="ghost" onClick={handleRemovePane} />
          </Tooltip>
        </Show>

        <Show when={totalPages() > 1}>
          <div class="h-4 w-px bg-border-weak-base" />
          <div class="flex items-center gap-1">
            <Tooltip value="Previous page">
              <IconButton
                icon="arrow-left"
                variant="ghost"
                onClick={multiPane.prevPage}
                disabled={currentPage() <= 1}
              />
            </Tooltip>
            <span class="text-12-regular text-text-weak min-w-[50px] text-center">
              {currentPage()}/{totalPages()}
            </span>
            <Tooltip value="Next page">
              <IconButton
                icon="chevron-right"
                variant="ghost"
                onClick={multiPane.nextPage}
                disabled={currentPage() >= totalPages()}
              />
            </Tooltip>
          </div>
        </Show>

        <div class="text-12-regular text-text-weak">
          {paneCount()} tab{paneCount() !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  )
}

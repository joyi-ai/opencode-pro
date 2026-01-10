import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import type { Session } from "@opencode-ai/sdk/v2"

export function DialogWorktreeCleanup(props: { session: Session; onConfirm: (removeWorktree: boolean) => void }) {
  const dialog = useDialog()

  function handleDelete() {
    props.onConfirm(true)
    dialog.close()
  }

  function handleKeep() {
    props.onConfirm(false)
    dialog.close()
  }

  return (
    <Dialog title="Worktree Cleanup">
      <div class="flex flex-col gap-4 px-2.5 pb-3">
        <div class="flex items-start gap-3">
          <div class="p-2 rounded-lg bg-surface-warning-base/20">
            <Icon name="code" size="normal" class="text-icon-warning-base" />
          </div>
          <div class="flex flex-col gap-1">
            <div class="text-14-medium text-text-strong">Session has an active worktree</div>
            <div class="text-13-regular text-text-base">This session is using a git worktree at:</div>
            <div class="text-12-regular text-text-subtle break-all font-mono bg-surface-raised-base px-2 py-1 rounded mt-1">
              {(props.session as any).worktree?.path}
            </div>
          </div>
        </div>

        <div class="text-13-regular text-text-base">What would you like to do with the worktree?</div>

        <div class="flex flex-col gap-2 pt-2 border-t border-border-base">
          <Button
            variant="primary"
            size="large"
            class="w-full justify-start gap-2 bg-surface-critical-base hover:bg-surface-critical-base-hover"
            onClick={handleDelete}
          >
            <Icon name="close" size="small" />
            Delete worktree and archive session
          </Button>
          <Button variant="ghost" size="large" class="w-full justify-start gap-2" onClick={handleKeep}>
            <Icon name="folder" size="small" />
            Keep worktree and archive session
          </Button>
          <Button variant="ghost" size="large" class="w-full justify-start gap-2" onClick={() => dialog.close()}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

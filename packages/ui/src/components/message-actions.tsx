import { Show, createSignal, onCleanup, splitProps, type ComponentProps } from "solid-js"
import { IconButton } from "./icon-button"

export type MessageActionHandlers = {
  onEdit?: () => void
  onRestore?: () => void
  onRetry?: () => void
  onDelete?: () => void
}

export function MessageActions(props: ComponentProps<"div"> & MessageActionHandlers) {
  const [local, others] = splitProps(props, ["onEdit", "onRestore", "onRetry", "onDelete", "class", "classList"])
  const hasEdit = () => !!local.onEdit
  const hasRestore = () => !!local.onRestore
  const hasRetry = () => !!local.onRetry
  const hasDelete = () => !!local.onDelete
  const hasActions = () => hasEdit() || hasRestore() || hasRetry() || hasDelete()
  const [confirmDelete, setConfirmDelete] = createSignal(false)
  let confirmTimeout: ReturnType<typeof setTimeout> | undefined

  const clearConfirm = () => {
    if (confirmTimeout) {
      clearTimeout(confirmTimeout)
      confirmTimeout = undefined
    }
    setConfirmDelete(false)
  }

  onCleanup(() => {
    if (confirmTimeout) clearTimeout(confirmTimeout)
  })

  const handleDelete = () => {
    if (!local.onDelete) return
    if (confirmDelete()) {
      clearConfirm()
      local.onDelete()
      return
    }
    setConfirmDelete(true)
    if (confirmTimeout) clearTimeout(confirmTimeout)
    confirmTimeout = setTimeout(() => {
      confirmTimeout = undefined
      setConfirmDelete(false)
    }, 2000)
  }

  return (
    <Show when={hasActions()}>
      <div
        {...others}
        data-component="message-actions"
        classList={{
          ...(local.classList ?? {}),
          [local.class ?? ""]: !!local.class,
        }}
      >
        <Show when={hasEdit()}>
          <IconButton
            variant="ghost"
            icon="edit-small-2"
            aria-label="Edit message"
            title="Edit"
            onClick={() => local.onEdit?.()}
          />
        </Show>
        <Show when={hasRestore()}>
          <IconButton
            variant="ghost"
            icon="arrow-left"
            aria-label="Restore checkpoint"
            title="Restore"
            onClick={() => local.onRestore?.()}
          />
        </Show>
        <Show when={hasRetry()}>
          <IconButton
            variant="ghost"
            icon="arrow-up"
            aria-label="Retry message"
            title="Retry"
            onClick={() => local.onRetry?.()}
          />
        </Show>
        <Show when={hasDelete()}>
          <IconButton
            variant="ghost"
            icon="circle-x"
            aria-label={confirmDelete() ? "Confirm delete message" : "Delete message"}
            title={confirmDelete() ? "Confirm delete" : "Delete"}
            data-slot="message-action-delete"
            data-confirm={confirmDelete() ? "true" : undefined}
            onClick={handleDelete}
          />
        </Show>
      </div>
    </Show>
  )
}

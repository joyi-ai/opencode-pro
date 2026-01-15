import { Show, createSignal, onCleanup, splitProps, type ComponentProps } from "solid-js"
import { IconButton } from "./icon-button"
import { Tooltip } from "./tooltip"

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
  const [confirmAction, setConfirmAction] = createSignal<"delete" | "restore" | undefined>()
  const confirmTimeout = {
    current: undefined as ReturnType<typeof setTimeout> | undefined,
  }

  const clearConfirm = () => {
    const current = confirmTimeout.current
    if (current) {
      clearTimeout(current)
      confirmTimeout.current = undefined
    }
    setConfirmAction(undefined)
  }

  onCleanup(() => {
    const current = confirmTimeout.current
    if (current) clearTimeout(current)
  })

  const armConfirm = (action: "delete" | "restore") => {
    setConfirmAction(action)
    const current = confirmTimeout.current
    if (current) clearTimeout(current)
    confirmTimeout.current = setTimeout(() => {
      confirmTimeout.current = undefined
      setConfirmAction(undefined)
    }, 2000)
  }

  const isConfirming = (action: "delete" | "restore") => confirmAction() === action

  const handleRestore = () => {
    if (!local.onRestore) return
    if (isConfirming("restore")) {
      clearConfirm()
      local.onRestore()
      return
    }
    armConfirm("restore")
  }

  const handleDelete = () => {
    if (!local.onDelete) return
    if (isConfirming("delete")) {
      clearConfirm()
      local.onDelete()
      return
    }
    armConfirm("delete")
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
          <Tooltip value="Edit" placement="top" gutter={8}>
            <IconButton
              variant="ghost"
              icon="edit-small-2"
              aria-label="Edit message"
              onClick={() => local.onEdit?.()}
            />
          </Tooltip>
        </Show>
        <Show when={hasRestore()}>
          <Tooltip value={isConfirming("restore") ? "Confirm restore" : "Restore checkpoint"} placement="top" gutter={8}>
            <IconButton
              variant="ghost"
              icon="revert"
              aria-label={isConfirming("restore") ? "Confirm restore checkpoint" : "Restore checkpoint"}
              data-slot="message-action-restore"
              data-confirm={isConfirming("restore") ? "true" : undefined}
              onClick={handleRestore}
            />
          </Tooltip>
        </Show>
        <Show when={hasRetry()}>
          <Tooltip value="Retry" placement="top" gutter={8}>
            <IconButton
              variant="ghost"
              icon="retry"
              aria-label="Retry message"
              onClick={() => local.onRetry?.()}
            />
          </Tooltip>
        </Show>
        <Show when={hasDelete()}>
          <Tooltip value={isConfirming("delete") ? "Confirm delete" : "Delete"} placement="top" gutter={8}>
            <IconButton
              variant="ghost"
              icon="circle-x"
              aria-label={isConfirming("delete") ? "Confirm delete message" : "Delete message"}
              data-slot="message-action-delete"
              data-confirm={isConfirming("delete") ? "true" : undefined}
              onClick={handleDelete}
            />
          </Tooltip>
        </Show>
      </div>
    </Show>
  )
}

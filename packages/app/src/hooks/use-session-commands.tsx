import { createMemo, type Accessor } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useCommand } from "@/context/command"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLocal } from "@/context/local"
import { useLayout } from "@/context/layout"
import { useTerminal } from "@/context/terminal"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { usePrompt } from "@/context/prompt"
import { usePermission } from "@/context/permission"
import { DialogSelectFile } from "@/components/dialog-select-file"
import { DialogSelectModel } from "@/components/dialog-select-model"
import { DialogSelectMcp } from "@/components/dialog-select-mcp"
import { showToast } from "@opencode-ai/ui/toast"
import { extractPromptFromParts } from "@/utils/prompt"
import { base64Encode } from "@opencode-ai/util/encode"

export interface UseSessionCommandsOptions {
  sessionId: Accessor<string | undefined>
  sessionKey: Accessor<string>
  isEnabled?: Accessor<boolean>
  onNavigateMessage: (offset: number) => void
  onToggleSteps: () => void
  onResetMessageToLast: () => void
  setActiveMessage: (message: unknown) => void
  userMessages: Accessor<{ id: string }[]>
  visibleUserMessages: Accessor<{ id: string }[]>
}

export function useSessionCommands(options: UseSessionCommandsOptions): void {
  const navigate = useNavigate()
  const command = useCommand()
  const dialog = useDialog()
  const local = useLocal()
  const layout = useLayout()
  const terminal = useTerminal()
  const sdk = useSDK()
  const sync = useSync()
  const prompt = usePrompt()
  const permission = usePermission()
  const view = createMemo(() => layout.view(options.sessionKey()))

  const enabled = () => options.isEnabled?.() ?? true
  const notify = (label: string) => {
    showToast({
      variant: "notifier",
      title: label,
    })
  }

  command.register(() => [
    {
      id: "session.new",
      title: "New session",
      description: "Create a new session",
      category: "Session",
      keybind: "mod+shift+s",
      slash: "new",
      disabled: !enabled(),
      onSelect: () => navigate(`/${base64Encode(sdk.directory)}/session`),
    },
    {
      id: "file.open",
      title: "Open file",
      description: "Search and open a file",
      category: "File",
      keybind: "mod+p",
      slash: "open",
      disabled: !enabled(),
      onSelect: () => dialog.show(() => <DialogSelectFile />),
    },
    {
      id: "terminal.toggle",
      title: "Toggle terminal",
      description: "Show or hide the terminal",
      category: "View",
      keybind: "ctrl+`",
      slash: "terminal",
      disabled: !enabled(),
      onSelect: () => view().terminal.toggle(),
    },
    {
      id: "review.toggle",
      title: "Toggle review",
      description: "Show or hide the review panel",
      category: "View",
      keybind: "mod+shift+r",
      disabled: !enabled(),
      onSelect: () => view().reviewPanel.toggle(),
    },
    {
      id: "terminal.new",
      title: "New terminal",
      description: "Create a new terminal tab",
      category: "Terminal",
      keybind: "ctrl+shift+`",
      disabled: !enabled(),
      onSelect: () => terminal.new(),
    },
    {
      id: "steps.toggle",
      title: "Toggle steps",
      description: "Show or hide the steps",
      category: "View",
      keybind: "mod+e",
      slash: "steps",
      disabled: !enabled() || !options.sessionId(),
      onSelect: () => options.onToggleSteps(),
    },
    {
      id: "message.previous",
      title: "Previous message",
      description: "Go to the previous user message",
      category: "Session",
      keybind: "mod+arrowup",
      disabled: !enabled() || !options.sessionId(),
      onSelect: () => options.onNavigateMessage(-1),
    },
    {
      id: "message.next",
      title: "Next message",
      description: "Go to the next user message",
      category: "Session",
      keybind: "mod+arrowdown",
      disabled: !enabled() || !options.sessionId(),
      onSelect: () => options.onNavigateMessage(1),
    },
    {
      id: "model.choose",
      title: "Choose model",
      description: "Select a different model",
      category: "Model",
      keybind: "mod+'",
      slash: "model",
      disabled: !enabled(),
      onSelect: () => {
        dialog.show(() => <DialogSelectModel />)
      },
    },
    {
      id: "model.cycle",
      title: "Cycle model",
      description: "Switch to the next recent model",
      category: "Model",
      keybind: "f2",
      disabled: !enabled(),
      onSelect: () => {
        local.model.cycle(1)
        notify(local.model.current()?.name ?? "Model")
      },
    },
    {
      id: "model.cycle.reverse",
      title: "Cycle model backwards",
      description: "Switch to the previous recent model",
      category: "Model",
      keybind: "shift+f2",
      disabled: !enabled(),
      onSelect: () => {
        local.model.cycle(-1)
        notify(local.model.current()?.name ?? "Model")
      },
    },
    {
      id: "mcp.toggle",
      title: "Toggle MCPs",
      description: "Toggle MCPs",
      category: "MCP",
      keybind: "mod+;",
      slash: "mcp",
      disabled: !enabled(),
      onSelect: () => dialog.show(() => <DialogSelectMcp />),
    },
    {
      id: "agent.cycle",
      title: "Cycle agent",
      description: "Switch to the next agent",
      category: "Agent",
      keybind: "tab,mod+.",
      slash: "agent",
      disabled: !enabled(),
      onSelect: () => {
        local.agent.move(1)
        notify(local.agent.current()?.name ?? "Agent")
      },
    },
    {
      id: "agent.cycle.reverse",
      title: "Cycle agent backwards",
      description: "Switch to the previous agent",
      category: "Agent",
      keybind: "shift+mod+.",
      disabled: !enabled(),
      onSelect: () => {
        local.agent.move(-1)
        notify(local.agent.current()?.name ?? "Agent")
      },
    },
    {
      id: "mode.cycle",
      title: "Cycle mode",
      description: "Switch to the next mode",
      category: "Mode",
      keybind: "shift+tab",
      slash: "mode",
      disabled: !enabled(),
      onSelect: () => {
        local.mode.move(1)
        notify(local.mode.current()?.name ?? "Default")
      },
    },
    {
      id: "model.variant.cycle",
      title: "Cycle thinking effort",
      description: "Switch to the next effort level",
      category: "Model",
      keybind: "shift+mod+t",
      disabled: !enabled(),
      onSelect: () => {
        local.model.variant.cycle()
        notify(local.model.variant.current() ?? "Default")
      },
    },
    {
      id: "model.thinking.toggle",
      title: "Toggle thinking",
      description: "Toggle extended thinking",
      category: "Model",
      keybind: "mod+shift+e",
      disabled: !enabled(),
      onSelect: () => {
        local.model.thinking.toggle()
        notify(local.model.thinking.current() ? "Thinking On" : "Thinking Off")
      },
    },
    {
      id: "permissions.autoaccept",
      title:
        options.sessionId() && permission.isAutoAccepting(options.sessionId()!)
          ? "Stop auto-accepting edits"
          : "Auto-accept edits",
      category: "Permissions",
      keybind: "mod+shift+a",
      disabled: !enabled() || !options.sessionId() || !permission.permissionsEnabled(),
      onSelect: () => {
        const sessionID = options.sessionId()
        if (!sessionID) return
        permission.toggleAutoAccept(sessionID, sdk.directory)
        showToast({
          title: permission.isAutoAccepting(sessionID) ? "Auto-accepting edits" : "Stopped auto-accepting edits",
          description: permission.isAutoAccepting(sessionID)
            ? "Edit and write permissions will be automatically approved"
            : "Edit and write permissions will require approval",
        })
      },
    },
    {
      id: "session.undo",
      title: "Undo",
      description: "Undo the last message",
      category: "Session",
      slash: "undo",
      disabled: !enabled() || !options.sessionId() || options.visibleUserMessages().length === 0,
      onSelect: async () => {
        const sessionID = options.sessionId()
        if (!sessionID) return
        const info = sync.session.get(sessionID)
        const status = sync.data.session_status[sessionID]
        if (status?.type !== "idle") {
          await sdk.client.session.abort({ sessionID }).catch(() => {})
        }
        const revert = info?.revert?.messageID
        const message = options.userMessages().findLast((x) => !revert || x.id < revert)
        if (!message) return
        await sdk.client.session.revert({ sessionID, messageID: message.id })
        const parts = sync.data.part[message.id]
        if (parts) {
          const restored = extractPromptFromParts(parts)
          prompt.set(restored)
        }
        const priorMessage = options.userMessages().findLast((x) => x.id < message.id)
        options.setActiveMessage(priorMessage)
      },
    },
    {
      id: "session.redo",
      title: "Redo",
      description: "Redo the last undone message",
      category: "Session",
      slash: "redo",
      disabled: !enabled() || !options.sessionId() || !sync.session.get(options.sessionId()!)?.revert?.messageID,
      onSelect: async () => {
        const sessionID = options.sessionId()
        if (!sessionID) return
        const info = sync.session.get(sessionID)
        const revertMessageID = info?.revert?.messageID
        if (!revertMessageID) return
        const nextMessage = options.userMessages().find((x) => x.id > revertMessageID)
        if (!nextMessage) {
          await sdk.client.session.unrevert({ sessionID })
          prompt.reset()
          const lastMsg = options.userMessages().findLast((x) => x.id >= revertMessageID)
          options.setActiveMessage(lastMsg)
          return
        }
        await sdk.client.session.revert({ sessionID, messageID: nextMessage.id })
        const priorMsg = options.userMessages().findLast((x) => x.id < nextMessage.id)
        options.setActiveMessage(priorMsg)
      },
    },
  ])
}

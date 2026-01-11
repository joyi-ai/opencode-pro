import { Component } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { ModeSettingsPanel } from "@/components/mode-settings-panel"
import type { ModeDefinition } from "@/modes/types"

export const DialogEditMode: Component<{ mode: ModeDefinition }> = (props) => {
  const dialog = useDialog()

  return (
    <Dialog title={`Edit ${props.mode.name} mode`} description="Customize defaults and mode-specific behavior.">
      <div class="px-2.5 pb-3">
        <ModeSettingsPanel mode={props.mode} onClose={() => dialog.close()} showCancel />
      </div>
    </Dialog>
  )
}

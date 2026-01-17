import { createMemo, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useSync } from "@/context/sync"
import { SettingsDialog } from "@/components/settings-dialog"

export function SessionMcpIndicator() {
  const sync = useSync()
  const dialog = useDialog()

  const mcpStats = createMemo(() => {
    const mcp = sync.data.mcp ?? {}
    const entries = Object.entries(mcp)
    const enabled = entries.filter(([, status]) => status.status === "connected").length
    const failed = entries.some(([, status]) => status.status === "failed")
    const total = entries.length
    return { enabled, failed, total }
  })

  return (
    <Show when={mcpStats().total > 0}>
      <Button variant="ghost" onClick={() => dialog.show(() => <SettingsDialog initialTab="mcp" />)}>
        <div
          classList={{
            "size-1.5 rounded-full": true,
            "bg-icon-critical-base": mcpStats().failed,
            "bg-icon-success-base": !mcpStats().failed && mcpStats().enabled > 0,
          }}
        />
        <span class="text-12-regular text-text-weak">{mcpStats().enabled} MCP</span>
      </Button>
    </Show>
  )
}

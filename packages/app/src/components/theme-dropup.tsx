import { createMemo, createSignal, For, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { useTheme } from "@opencode-ai/ui/theme"
import type { GradientMode, GradientColor } from "@opencode-ai/ui/theme/context"

const GRADIENT_MODES: { id: GradientMode; label: string }[] = [
  { id: "soft", label: "Soft" },
  { id: "crisp", label: "Crisp" },
]

const GRADIENT_COLORS: { id: GradientColor; label: string }[] = [
  { id: "relative", label: "Relative" },
  { id: "strong", label: "Strong" },
]

export function ThemeDropup() {
  const theme = useTheme()
  const [open, setOpen] = createSignal(false)

  const items = createMemo(() =>
    Object.entries(theme.themes())
      .map(([id, definition]) => ({
        id,
        name: definition.name ?? id,
      }))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
  )

  return (
    <Popover
      placement="top-end"
      open={open()}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) theme.cancelPreview()
      }}
      trigger={
        <Button size="normal" variant="ghost" class="px-3 text-12-regular text-text-weak">
          theme
          <Icon name="chevron-down" size="small" class="rotate-180" />
        </Button>
      }
      class="w-64"
    >
      <div class="flex flex-col gap-1" onMouseLeave={() => theme.cancelPreview()}>
        <div class="flex flex-col gap-1 pb-2 mb-2 border-b border-border-weak-base">
          <div class="text-11-medium text-text-weak px-2 py-1">Gradient</div>
          <div
            class="flex gap-1"
            onMouseLeave={() => theme.cancelGradientModePreview()}
            onFocusOut={(event) => {
              const next = event.relatedTarget as HTMLElement | null
              if (next && event.currentTarget.contains(next)) return
              theme.cancelGradientModePreview()
            }}
          >
            <For each={GRADIENT_MODES}>
              {(mode) => {
                const selected = () => mode.id === theme.gradientMode()
                return (
                  <Button
                    size="small"
                    variant={selected() ? "secondary" : "ghost"}
                    class="flex-1 justify-center px-2"
                    onClick={() => theme.setGradientMode(mode.id)}
                    onMouseEnter={() => theme.previewGradientMode(mode.id)}
                    onFocus={() => theme.previewGradientMode(mode.id)}
                  >
                    {mode.label}
                  </Button>
                )
              }}
            </For>
          </div>
          <div class="text-11-medium text-text-weak px-2 py-1 mt-1">Color</div>
          <div
            class="flex gap-1"
            onMouseLeave={() => theme.cancelGradientColorPreview()}
            onFocusOut={(event) => {
              const next = event.relatedTarget as HTMLElement | null
              if (next && event.currentTarget.contains(next)) return
              theme.cancelGradientColorPreview()
            }}
          >
            <For each={GRADIENT_COLORS}>
              {(color) => {
                const selected = () => color.id === theme.gradientColor()
                return (
                  <Button
                    size="small"
                    variant={selected() ? "secondary" : "ghost"}
                    class="flex-1 justify-center px-2"
                    onClick={() => theme.setGradientColor(color.id)}
                    onMouseEnter={() => theme.previewGradientColor(color.id)}
                    onFocus={() => theme.previewGradientColor(color.id)}
                  >
                    {color.label}
                  </Button>
                )
              }}
            </For>
          </div>
        </div>
        <div
          class="flex flex-col gap-1"
          onMouseLeave={() => theme.cancelThemePreview()}
          onFocusOut={(event) => {
            const next = event.relatedTarget as HTMLElement | null
            if (next && event.currentTarget.contains(next)) return
            theme.cancelThemePreview()
          }}
        >
          <For each={items()}>
            {(item) => {
              const selected = () => item.id === theme.themeId()
              return (
                <Button
                  size="normal"
                  variant={selected() ? "secondary" : "ghost"}
                  class="justify-between px-2"
                  onClick={() => {
                    theme.setTheme(item.id)
                    theme.cancelPreview()
                    setOpen(false)
                  }}
                  onMouseEnter={() => theme.previewTheme(item.id)}
                  onFocus={() => theme.previewTheme(item.id)}
                >
                  <span class="truncate">{item.name}</span>
                  <Show when={selected()}>
                    <Icon name="check-small" size="small" class="text-text-accent-base" />
                  </Show>
                </Button>
              )
            }}
          </For>
        </div>
      </div>
    </Popover>
  )
}

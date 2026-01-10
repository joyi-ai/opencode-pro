import { createSignal, type Accessor, type Setter } from "solid-js"

interface KeybindCaptureOptions {
  /** Called when a keybind is successfully captured */
  onCapture?: (keybind: string) => void
}

interface KeybindCaptureResult {
  isCapturing: Accessor<boolean>
  setIsCapturing: Setter<boolean>
  capturedKeybind: Accessor<string>
  setCapturedKeybind: Setter<string>
  handleKeyDown: (e: KeyboardEvent) => boolean
}

/**
 * Hook for capturing keyboard shortcuts.
 * Returns signals for capture state and a keydown handler.
 *
 * @param initialKeybind - Initial keybind value
 * @param options.onCapture - Optional callback when keybind is captured (for immediate save)
 */
export function useKeybindCapture(initialKeybind: string, options?: KeybindCaptureOptions): KeybindCaptureResult {
  const [isCapturing, setIsCapturing] = createSignal(false)
  const [capturedKeybind, setCapturedKeybind] = createSignal(initialKeybind)

  const handleKeyDown = (e: KeyboardEvent): boolean => {
    if (!isCapturing()) return false

    e.preventDefault()
    e.stopPropagation()

    const parts: string[] = []
    if (e.ctrlKey || e.metaKey) parts.push("mod")
    if (e.altKey) parts.push("alt")
    if (e.shiftKey) parts.push("shift")

    const key = e.key.toLowerCase()
    if (!["control", "meta", "alt", "shift"].includes(key)) {
      parts.push(key)
      const newKeybind = parts.join("+")
      setCapturedKeybind(newKeybind)
      setIsCapturing(false)
      options?.onCapture?.(newKeybind)
      return true // captured
    }
    return false // still waiting for non-modifier key
  }

  return {
    isCapturing,
    setIsCapturing,
    capturedKeybind,
    setCapturedKeybind,
    handleKeyDown,
  }
}

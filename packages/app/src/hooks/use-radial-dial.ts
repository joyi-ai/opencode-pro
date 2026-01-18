import { createSignal, onCleanup, batch, type Accessor } from "solid-js"

export type RadialDialAction = "new" | "close" | "clone" | "expand" | "history"

export interface UseRadialDialOptions {
  holdDelay?: number
  onAction: (action: RadialDialAction) => void
}

export interface UseRadialDialReturn {
  isOpen: Accessor<boolean>
  centerX: Accessor<number>
  centerY: Accessor<number>
  highlightedAction: Accessor<RadialDialAction | null>
  handlers: {
    onMouseDown: (e: MouseEvent) => void
    onMouseMove: (e: MouseEvent) => void
    onMouseUp: (e: MouseEvent) => void
    onContextMenu: (e: MouseEvent) => void
  }
}

const INNER_RADIUS = 40

function angleToAction(angle: number): RadialDialAction {
  // Normalize angle to 0-360
  const normalized = ((angle % 360) + 360) % 360

  // Map 5 equal segments (72° each) to actions (0 degrees = top, clockwise)
  // Top row (left to right): Close, Expand, New
  // Bottom row (left to right): History, Clone
  //
  // Close: 252-324 (top-left)
  // Expand: 324-36 (top-center, wraps through 0°)
  // New: 36-108 (top-right)
  // Clone: 108-180 (bottom-right)
  // History: 180-252 (bottom-left)
  if (normalized >= 252 && normalized < 324) return "close"
  if (normalized >= 324 || normalized < 36) return "expand"
  if (normalized >= 36 && normalized < 108) return "new"
  if (normalized >= 108 && normalized < 180) return "clone"
  return "history"
}

export function useRadialDial(options: UseRadialDialOptions): UseRadialDialReturn {
  const holdDelay = options.holdDelay ?? 50

  const [isOpen, setIsOpen] = createSignal(false)
  const [centerX, setCenterX] = createSignal(0)
  const [centerY, setCenterY] = createSignal(0)
  const [highlightedAction, setHighlightedAction] = createSignal<RadialDialAction | null>(null)

  let holdTimer: ReturnType<typeof setTimeout> | null = null
  let isHolding = false

  function cleanup() {
    if (holdTimer) {
      clearTimeout(holdTimer)
      holdTimer = null
    }
    isHolding = false
  }

  onCleanup(cleanup)

  function handleMouseDown(e: MouseEvent) {
    // If left button is pressed while we have a pending timer, cancel it
    // This handles the case where user presses left slightly after right (for floating selector)
    if (e.button === 0) {
      if (isHolding || holdTimer) {
        cleanup()
      }
      return
    }

    // Only respond to right-click
    if (e.button !== 2) return

    // Don't trigger if left button is also pressed (that's for floating selector)
    if (e.buttons & 1) return

    e.preventDefault()
    isHolding = true

    holdTimer = setTimeout(() => {
      if (isHolding) {
        batch(() => {
          setCenterX(e.clientX)
          setCenterY(e.clientY)
          setIsOpen(true)
        })
      }
    }, holdDelay)
  }

  function handleMouseMove(e: MouseEvent) {
    // If left button is pressed while radial dial is active, close it (user is doing left+right click for floating selector)
    if (isHolding || isOpen()) {
      if (e.buttons & 1) {
        cleanup()
        if (isOpen()) {
          batch(() => {
            setIsOpen(false)
            setHighlightedAction(null)
          })
        }
        return
      }
    }

    if (!isOpen()) return

    const dx = e.clientX - centerX()
    const dy = e.clientY - centerY()
    const distance = Math.sqrt(dx * dx + dy * dy)

    // Dead zone in center
    if (distance < INNER_RADIUS) {
      setHighlightedAction(null)
      return
    }

    // Calculate angle (atan2 returns radians, convert to degrees)
    // atan2(y, x) gives angle from positive x-axis
    // We want angle from positive y-axis (top), so we rotate by 90 degrees
    const angleRad = Math.atan2(dy, dx)
    const angleDeg = (angleRad * 180) / Math.PI + 90

    const action = angleToAction(angleDeg)
    setHighlightedAction(action)
  }

  function handleMouseUp(_e: MouseEvent) {
    cleanup()

    if (isOpen()) {
      const action = highlightedAction()
      batch(() => {
        setIsOpen(false)
        setHighlightedAction(null)
      })

      if (action) {
        options.onAction(action)
      }
    }
  }

  function handleContextMenu(e: MouseEvent) {
    // Always prevent default context menu - we use right-click for the radial dial
    e.preventDefault()
  }

  return {
    isOpen,
    centerX,
    centerY,
    highlightedAction,
    handlers: {
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onContextMenu: handleContextMenu,
    },
  }
}

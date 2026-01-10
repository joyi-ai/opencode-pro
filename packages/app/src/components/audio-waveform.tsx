import { createEffect, createSignal, onCleanup, For } from "solid-js"

const TAU = Math.PI * 2
const LEVEL_SMOOTHING = 0.18
const TARGET_DECAY_PER_FRAME = 0.985
const WAVE_BASE_PHASE_STEP = 0.11
const WAVE_PHASE_GAIN = 0.32
const MIN_AMPLITUDE = 0.03
const MAX_AMPLITUDE = 1.3
const PROCESSING_BASE_LEVEL = 0.16
const DEFAULT_WIDTH = 120
const DEFAULT_HEIGHT = 36

type WaveConfig = {
  frequency: number
  multiplier: number
  phaseOffset: number
  opacity: number
}

const WAVE_CONFIG: WaveConfig[] = [
  { frequency: 0.8, multiplier: 1.6, phaseOffset: 0, opacity: 1 },
  { frequency: 1.0, multiplier: 1.35, phaseOffset: 0.85, opacity: 0.78 },
  { frequency: 1.25, multiplier: 1.05, phaseOffset: 1.7, opacity: 0.56 },
]

type AnimationState = {
  phase: number
  currentLevel: number
  targetLevel: number
}

const createWavePath = (
  width: number,
  baseline: number,
  amplitude: number,
  frequency: number,
  phase: number,
): string => {
  const segments = Math.max(72, Math.floor(width / 2))
  let path = `M 0 ${baseline + amplitude * Math.sin(phase)}`

  for (let index = 1; index <= segments; index += 1) {
    const t = index / segments
    const x = width * t
    const theta = frequency * t * TAU + phase
    const y = baseline + amplitude * Math.sin(theta)
    path += ` L ${x} ${y}`
  }

  return path
}

export interface AudioWaveformProps {
  levels: number[]
  active: boolean
  processing?: boolean
  width?: number
  height?: number
  strokeColor?: string
  strokeWidth?: number
  class?: string
  classList?: Record<string, boolean | undefined>
}

export function AudioWaveform(props: AudioWaveformProps) {
  const width = () => props.width ?? DEFAULT_WIDTH
  const height = () => props.height ?? DEFAULT_HEIGHT
  const strokeColor = () => props.strokeColor ?? "currentColor"
  const strokeWidth = () => props.strokeWidth ?? 1.6

  const waveRefs: (SVGPathElement | null)[] = []
  let animationFrameRef: number | null = null
  const animationState: AnimationState = {
    phase: 0,
    currentLevel: 0,
    targetLevel: 0,
  }

  // Initialize paths
  createEffect(() => {
    const baseline = height() / 2
    const defaultPath = `M 0 ${baseline} L ${width()} ${baseline}`
    waveRefs.forEach((path, index) => {
      if (!path) return
      path.setAttribute("d", defaultPath)
      path.setAttribute("opacity", (WAVE_CONFIG[index]?.opacity ?? 1).toString())
    })
  })

  // Handle active/processing state changes
  createEffect(() => {
    const active = props.active
    const processing = props.processing ?? false

    if (!active) {
      animationState.targetLevel = processing ? Math.max(animationState.targetLevel, PROCESSING_BASE_LEVEL) : 0
      if (!processing) {
        animationState.currentLevel *= 0.4
        if (animationState.currentLevel < 0.0002) {
          animationState.currentLevel = 0
        }
      }
    }
  })

  // Update target level from audio levels
  createEffect(() => {
    const levels = props.levels
    const active = props.active

    if (!active || levels.length === 0) return

    const sum = levels.reduce((acc, value) => acc + value, 0)
    const average = sum / levels.length
    const peak = levels.reduce((acc, value) => (value > acc ? value : acc), 0)
    // Reduced sensitivity: lower multipliers for a calmer waveform
    const combined = Math.min(1, average * 0.5 + peak * 0.5)
    const boosted = Math.min(1, Math.sqrt(combined) * 0.9)

    animationState.targetLevel = Math.min(1, animationState.targetLevel * 0.25 + boosted * 0.75)
  })

  // Animation loop
  createEffect(() => {
    const active = props.active
    const processing = props.processing ?? false

    if (!(active || processing)) {
      animationState.targetLevel = 0
      animationState.currentLevel = 0
      animationState.phase = 0

      const baseline = height() / 2
      const defaultPath = `M 0 ${baseline} L ${width()} ${baseline}`

      waveRefs.forEach((path, index) => {
        if (!path) return
        path.setAttribute("d", defaultPath)
        path.setAttribute("opacity", (WAVE_CONFIG[index]?.opacity ?? 1).toString())
      })

      if (animationFrameRef) {
        cancelAnimationFrame(animationFrameRef)
        animationFrameRef = null
      }

      return
    }

    const step = () => {
      animationState.currentLevel += (animationState.targetLevel - animationState.currentLevel) * LEVEL_SMOOTHING
      if (animationState.currentLevel < 0.0002) {
        animationState.currentLevel = 0
      }

      animationState.targetLevel *= TARGET_DECAY_PER_FRAME
      if (animationState.targetLevel < 0.0005) {
        animationState.targetLevel = 0
      }

      const baseLevel = processing && !active ? PROCESSING_BASE_LEVEL : 0
      const level = Math.max(baseLevel, animationState.currentLevel)

      const advance = WAVE_BASE_PHASE_STEP + WAVE_PHASE_GAIN * level
      animationState.phase = (animationState.phase + advance) % TAU

      const baseline = height() / 2
      const waveHeight = height()
      const waveWidth = width()

      waveRefs.forEach((path, index) => {
        if (!path) return
        const config = WAVE_CONFIG[index] ?? WAVE_CONFIG[WAVE_CONFIG.length - 1]
        const amplitudeFactor = Math.min(MAX_AMPLITUDE, Math.max(MIN_AMPLITUDE, level * config.multiplier))
        const amplitude = Math.max(1, waveHeight * 0.75 * amplitudeFactor)
        const phase = animationState.phase + config.phaseOffset
        const pathD = createWavePath(waveWidth, baseline, amplitude, config.frequency, phase)
        path.setAttribute("d", pathD)
        path.setAttribute("opacity", config.opacity.toString())
      })

      animationFrameRef = requestAnimationFrame(step)
    }

    animationFrameRef = requestAnimationFrame(step)

    onCleanup(() => {
      if (animationFrameRef) {
        cancelAnimationFrame(animationFrameRef)
        animationFrameRef = null
      }
    })
  })

  onCleanup(() => {
    if (animationFrameRef) {
      cancelAnimationFrame(animationFrameRef)
      animationFrameRef = null
    }
  })

  return (
    <div class={`relative w-full h-full ${props.class ?? ""}`} classList={props.classList}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width()} ${height()}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <For each={WAVE_CONFIG}>
          {(config, index) => (
            <path
              ref={(el) => {
                waveRefs[index()] = el
              }}
              fill="none"
              stroke={strokeColor()}
              stroke-width={strokeWidth()}
              stroke-linecap="round"
              stroke-linejoin="round"
              opacity={config.opacity}
            />
          )}
        </For>
      </svg>
    </div>
  )
}

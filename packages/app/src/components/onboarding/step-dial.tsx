import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { For, Show, createSignal, onMount, onCleanup } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useOnboarding } from "./context"
import "./step-dial.css"

interface DialAction {
  action: string
  label: string
  icon: string
  description: string
  startAngle: number
  endAngle: number
}

const DIAL_ACTIONS: DialAction[] = [
  // All segments are equal size (72° each)
  // Top row (left to right): Close, Expand, New
  { action: "close", label: "Close", icon: "close", description: "Close current pane", startAngle: 252, endAngle: 324 },
  { action: "expand", label: "Expand", icon: "expand", description: "Toggle maximize", startAngle: 324, endAngle: 36 },
  { action: "new", label: "New", icon: "plus", description: "Create a new pane", startAngle: 36, endAngle: 108 },
  // Bottom row (left to right): History, Clone
  { action: "history", label: "History", icon: "history", description: "Browse session history", startAngle: 180, endAngle: 252 },
  { action: "clone", label: "Clone", icon: "copy", description: "Duplicate current pane", startAngle: 108, endAngle: 180 },
]

const INNER_RADIUS = 40
const OUTER_RADIUS = 100
const LABEL_RADIUS = 70

function polarToCartesian(angle: number, radius: number): { x: number; y: number } {
  const rad = ((angle - 90) * Math.PI) / 180
  return {
    x: radius * Math.cos(rad),
    y: radius * Math.sin(rad),
  }
}

function createArcPath(startAngle: number, endAngle: number, innerR: number, outerR: number): string {
  const normalizedEnd = endAngle < startAngle ? endAngle + 360 : endAngle
  const sweepAngle = normalizedEnd - startAngle

  const startOuter = polarToCartesian(startAngle, outerR)
  const endOuter = polarToCartesian(normalizedEnd, outerR)
  const startInner = polarToCartesian(normalizedEnd, innerR)
  const endInner = polarToCartesian(startAngle, innerR)

  const largeArc = sweepAngle > 180 ? 1 : 0

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${endInner.x} ${endInner.y}`,
    `Z`,
  ].join(" ")
}

function getLabelPosition(startAngle: number, endAngle: number): { x: number; y: number } {
  const normalizedEnd = endAngle < startAngle ? endAngle + 360 : endAngle
  const midAngle = (startAngle + normalizedEnd) / 2
  return polarToCartesian(midAngle, LABEL_RADIUS)
}

export function StepDial() {
  const onboarding = useOnboarding()
  const [highlightedIndex, setHighlightedIndex] = createSignal(0)

  // Cycle through highlights to show the dial actions
  onMount(() => {
    const interval = setInterval(() => {
      setHighlightedIndex((prev) => (prev + 1) % DIAL_ACTIONS.length)
    }, 1500)
    onCleanup(() => clearInterval(interval))
  })

  const handleFinish = () => {
    onboarding.nextStep() // This will finish since we're on step 3
  }

  const handleBack = () => {
    onboarding.prevStep()
  }

  const segments = DIAL_ACTIONS.map((seg) => ({
    ...seg,
    path: createArcPath(seg.startAngle, seg.endAngle, INNER_RADIUS, OUTER_RADIUS),
    labelPos: getLabelPosition(seg.startAngle, seg.endAngle),
  }))

  return (
    <Show when={onboarding.active() && onboarding.step() === 3}>
      <Kobalte open={true} modal={false}>
        <Kobalte.Portal>
          <div data-component="onboarding-dial-panel">
            <Kobalte.Content data-slot="panel-content">
              <div data-slot="panel-header">
                <Kobalte.Title data-slot="panel-title">Quick Pane Controls</Kobalte.Title>
                <IconButton icon="close" variant="ghost" onClick={handleFinish} />
              </div>

              <div data-slot="panel-body">
                <div data-slot="panel-description">
                  <p>Hold right-click anywhere on the screen to open the radial dial.</p>
                  <p>Drag towards an action, then release to select it.</p>
                  <p class="hint">Try it now!</p>
                </div>

                <div data-slot="dial-container">
                  <svg width="200" height="200" viewBox="-110 -110 220 220" data-slot="dial-svg">
                    {/* Background circle */}
                    <circle cx="0" cy="0" r="105" data-slot="dial-backdrop" />

                    {/* Segments */}
                    <For each={segments}>
                      {(segment, index) => (
                        <path
                          d={segment.path}
                          data-slot="dial-segment"
                          data-highlighted={highlightedIndex() === index()}
                        />
                      )}
                    </For>

                    {/* Labels with icons */}
                    <For each={segments}>
                      {(segment, index) => (
                        <g transform={`translate(${segment.labelPos.x}, ${segment.labelPos.y})`}>
                          <foreignObject x="-10" y="-18" width="20" height="20" style={{ overflow: "visible" }}>
                            <div data-slot="dial-icon" data-highlighted={highlightedIndex() === index()}>
                              <Icon name={segment.icon as any} size="small" />
                            </div>
                          </foreignObject>
                          <text y="12" data-slot="dial-label" data-highlighted={highlightedIndex() === index()}>
                            {segment.label}
                          </text>
                        </g>
                      )}
                    </For>

                    {/* Center indicator */}
                    <circle cx="0" cy="0" r="6" data-slot="dial-center" />
                  </svg>
                </div>

                <div data-slot="actions-list">
                  <For each={DIAL_ACTIONS}>
                    {(action, index) => (
                      <div data-slot="action-item" data-highlighted={highlightedIndex() === index()}>
                        <div data-slot="action-icon">
                          <Icon name={action.icon as any} size="small" />
                        </div>
                        <div data-slot="action-info">
                          <span data-slot="action-label">{action.label}</span>
                          <span data-slot="action-description">{action.description}</span>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              <div data-slot="panel-footer">
                <Button variant="ghost" size="small" onClick={handleBack}>
                  Back
                </Button>
                <Button variant="primary" size="small" onClick={handleFinish}>
                  Get Started
                </Button>
              </div>
            </Kobalte.Content>
          </div>
        </Kobalte.Portal>
      </Kobalte>
    </Show>
  )
}

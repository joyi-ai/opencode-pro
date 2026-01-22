import { For, createMemo } from "solid-js"
import { Icon } from "./icon"

export type RadialAction = "new" | "close" | "expand" | "history"

export interface RadialDialMenuProps {
  centerX: number
  centerY: number
  highlightedAction: RadialAction | null
}

interface Segment {
  action: RadialAction
  label: string
  icon: string
  startAngle: number
  endAngle: number
}

const SEGMENTS: Segment[] = [
  // All segments are equal size (90° each), rotated 45° clockwise
  // Top: Close, Right: New, Bottom: Expand, Left: History
  { action: "close", label: "Close", icon: "close", startAngle: 270, endAngle: 360 },
  { action: "expand", label: "Expand", icon: "expand", startAngle: 90, endAngle: 180 },
  { action: "new", label: "New", icon: "plus", startAngle: 0, endAngle: 90 },
  { action: "history", label: "History", icon: "history", startAngle: 180, endAngle: 270 },
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
  // Handle wrap-around (e.g., 315 to 45)
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

export function RadialDialMenu(props: RadialDialMenuProps) {
  const segments = createMemo(() =>
    SEGMENTS.map((seg) => ({
      ...seg,
      path: createArcPath(seg.startAngle, seg.endAngle, INNER_RADIUS, OUTER_RADIUS),
      labelPos: getLabelPosition(seg.startAngle, seg.endAngle),
    })),
  )

  return (
    <div
      data-component="radial-dial-menu"
      style={{
        position: "fixed",
        left: `${props.centerX}px`,
        top: `${props.centerY}px`,
        transform: "translate(-50%, -50%)",
        "pointer-events": "none",
        "z-index": "9999",
      }}
    >
      <svg width="240" height="240" viewBox="-120 -120 240 240" data-slot="radial-dial-svg">
        {/* Background blur circle */}
        <circle cx="0" cy="0" r="110" data-slot="radial-dial-backdrop" />

        {/* Segments */}
        <For each={segments()}>
          {(segment) => (
            <path
              d={segment.path}
              data-slot="radial-dial-segment"
              data-action={segment.action}
              data-highlighted={props.highlightedAction === segment.action}
            />
          )}
        </For>

        {/* Labels with icons */}
        <For each={segments()}>
          {(segment) => (
            <g
              data-slot="radial-dial-label-group"
              data-highlighted={props.highlightedAction === segment.action}
              transform={`translate(${segment.labelPos.x}, ${segment.labelPos.y})`}
            >
              <foreignObject x="-10" y="-18" width="20" height="20" style={{ overflow: "visible" }}>
                <div data-slot="radial-dial-icon" data-highlighted={props.highlightedAction === segment.action}>
                  <Icon name={segment.icon as any} size="small" />
                </div>
              </foreignObject>
              <text y="12" data-slot="radial-dial-label" data-highlighted={props.highlightedAction === segment.action}>
                {segment.label}
              </text>
            </g>
          )}
        </For>

        {/* Center indicator */}
        <circle cx="0" cy="0" r="6" data-slot="radial-dial-center" />
      </svg>
    </div>
  )
}

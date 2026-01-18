import { ComponentProps, For } from "solid-js"

const gridSize = 6
const totalDots = gridSize * gridSize
const spacing = 2.8
const dotRadius = 0.9

const center = (gridSize - 1) / 2
const maxRadius = center * 1.05 // Slightly larger than center to include middle dots

const colorClasses = ["color-1", "color-2", "color-3", "color-4"]

const dots = Array.from({ length: totalDots }, (_, i) => {
  const x = i % gridSize
  const y = Math.floor(i / gridSize)
  const distFromCenter = Math.sqrt((x - center) ** 2 + (y - center) ** 2)
  const isVisible = distFromCenter <= maxRadius
  const isOuter = distFromCenter > center * 0.7

  return {
    id: i,
    cx: x * spacing + dotRadius,
    cy: y * spacing + dotRadius,
    delay: Math.random() * 1.5,
    duration: 1 + Math.random() * 1,
    outer: isOuter,
    visible: isVisible,
    colorClass: colorClasses[i % colorClasses.length],
  }
})

const viewBoxSize = (gridSize - 1) * spacing + dotRadius * 2

export function Spinner(props: {
  class?: string
  classList?: ComponentProps<"div">["classList"]
  style?: ComponentProps<"div">["style"]
}) {
  return (
    <svg
      {...props}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      data-component="spinner"
      classList={{
        ...(props.classList ?? {}),
        [props.class ?? ""]: !!props.class,
      }}
    >
      <For each={dots}>
        {(dot) => (
          <circle
            cx={dot.cx}
            cy={dot.cy}
            r={dotRadius}
            data-color={dot.colorClass}
            style={{
              opacity: dot.visible ? undefined : 0,
              animation: dot.visible
                ? `${dot.outer ? "spinner-dot-dim" : "spinner-dot"} ${dot.duration}s ease-in-out infinite`
                : undefined,
              "animation-delay": dot.visible ? `${dot.delay}s` : undefined,
            }}
          />
        )}
      </For>
    </svg>
  )
}

import { Component, createMemo, createSignal, Show } from "solid-js"
import { Button } from "./button"
import { Icon } from "./icon"
import { Markdown } from "./markdown"
import type { ToolProps } from "./message-part"
import { useData } from "../context/data"
import "./plan-review.css"

interface ExitPlanModeInput {
  plan?: string
}

export interface PlanReviewProps extends ToolProps {
  sessionID?: string
  callID?: string
}

export const PlanReview: Component<PlanReviewProps> = (props) => {
  const data = useData()
  const input = () => props.input as ExitPlanModeInput
  const plan = () => input()?.plan ?? ""

  // Find the pending plan review request that matches this tool call
  const pendingRequest = createMemo(() => {
    if (!props.sessionID || !props.callID) return undefined
    const requests = data.store.planmode?.[props.sessionID] ?? []
    return requests.find((r) => r.callID === props.callID)
  })

  // Track submission state
  const [isSubmitting, setIsSubmitting] = createSignal(false)
  const [submitted, setSubmitted] = createSignal<"approved" | "rejected" | null>(null)

  const handleApprove = async () => {
    const request = pendingRequest()
    if (!request || !data.respondToPlanMode || isSubmitting()) return

    setIsSubmitting(true)
    try {
      await data.respondToPlanMode({
        requestID: request.id,
        approved: true,
      })
      setSubmitted("approved")
    } catch {
      setIsSubmitting(false)
    }
  }

  const handleReject = async () => {
    const request = pendingRequest()
    if (!request || !data.respondToPlanMode || isSubmitting()) return

    setIsSubmitting(true)
    try {
      await data.respondToPlanMode({
        requestID: request.id,
        approved: false,
      })
      setSubmitted("rejected")
    } catch {
      setIsSubmitting(false)
    }
  }

  // If already responded (completed status) or just submitted, show the result
  if (props.status === "completed" || submitted()) {
    const wasApproved = submitted() === "approved" || props.output?.includes("approved")
    return (
      <div data-component="plan-review" data-completed>
        <div data-slot="plan-review-response">
          <Show
            when={wasApproved}
            fallback={
              <>
                <Icon name="circle-ban-sign" size="small" class="text-icon-error-base" />
                <span>Plan rejected</span>
              </>
            }
          >
            <Icon name="check" size="small" class="text-icon-success-base" />
            <span>Plan approved</span>
          </Show>
        </div>
      </div>
    )
  }

  return (
    <div data-component="plan-review">
      <div data-slot="plan-review-header">
        <Icon name="checklist" size="small" class="text-icon-info-active" />
        <span>Plan Review</span>
      </div>
      <Show when={plan()}>
        <div data-slot="plan-review-content">
          <Markdown text={plan()} />
        </div>
      </Show>
      <div data-slot="plan-review-actions">
        <Button variant="ghost" size="small" onClick={handleReject} disabled={isSubmitting()}>
          <Show when={isSubmitting()} fallback="Reject">
            ...
          </Show>
        </Button>
        <Button variant="primary" size="small" onClick={handleApprove} disabled={isSubmitting()}>
          <Show when={isSubmitting()} fallback="Approve Plan">
            Approving...
          </Show>
        </Button>
      </div>
    </div>
  )
}

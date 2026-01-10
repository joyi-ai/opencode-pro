import { Component, createMemo, createSignal, For, Show } from "solid-js"
import { Button } from "./button"
import { Icon } from "./icon"
import { Tooltip } from "./tooltip"
import type { ToolProps } from "./message-part"
import { useData } from "../context/data"
import "./ask-user-question.css"

interface AskUserQuestionOption {
  label: string
  description: string
}

interface AskUserQuestionItem {
  question: string
  header: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
}

interface AskUserQuestionInput {
  questions: AskUserQuestionItem[]
}

export interface AskUserQuestionProps extends ToolProps {
  sessionID?: string
  callID?: string
}

export const AskUserQuestion: Component<AskUserQuestionProps> = (props) => {
  const data = useData()
  const input = () => props.input as AskUserQuestionInput
  const questions = () => input()?.questions ?? []

  // Find the pending AskUserQuestion request that matches this tool call
  const pendingRequest = createMemo(() => {
    if (!props.sessionID || !props.callID) return undefined
    const requests = data.store.askuser?.[props.sessionID] ?? []
    return requests.find((r) => r.callID === props.callID)
  })

  // Track selected options for each question
  const [selections, setSelections] = createSignal<Record<number, string[]>>({})
  // Track submission state
  const [isSubmitting, setIsSubmitting] = createSignal(false)
  const [submitted, setSubmitted] = createSignal(false)

  const toggleOption = (questionIndex: number, optionLabel: string, multiSelect: boolean) => {
    if (isSubmitting() || submitted()) return
    setSelections((prev) => {
      const current = prev[questionIndex] ?? []
      if (multiSelect) {
        // Toggle in multi-select mode
        if (current.includes(optionLabel)) {
          return { ...prev, [questionIndex]: current.filter((l) => l !== optionLabel) }
        }
        return { ...prev, [questionIndex]: [...current, optionLabel] }
      } else {
        // Single select mode
        return { ...prev, [questionIndex]: [optionLabel] }
      }
    })
  }

  const isSelected = (questionIndex: number, optionLabel: string) => {
    return (selections()[questionIndex] ?? []).includes(optionLabel)
  }

  const handleSubmit = async () => {
    const request = pendingRequest()
    if (!request || !data.respondToAskUser || isSubmitting()) return

    setIsSubmitting(true)

    // Build answers object - map question text to comma-separated selected labels
    const answers: Record<string, string> = {}
    questions().forEach((q, i) => {
      const selected = selections()[i] ?? []
      answers[q.question] = selected.join(", ")
    })

    try {
      await data.respondToAskUser({
        requestID: request.id,
        answers,
      })
      setSubmitted(true)
    } catch {
      setIsSubmitting(false)
    }
  }

  const hasSelections = () => {
    return questions().some((_, i) => (selections()[i] ?? []).length > 0)
  }

  // If already responded (completed status) or just submitted, show the completed view
  if ((props.status === "completed" && props.output) || submitted()) {
    return (
      <div data-component="ask-user-question" data-completed>
        <div data-slot="ask-user-response">
          <Icon name="check" size="small" class="text-icon-success-base" />
          <span>Response submitted</span>
        </div>
      </div>
    )
  }

  // Shared render for question options
  const renderQuestions = () => (
    <For each={questions()}>
      {(question, questionIndex) => (
        <div data-slot="ask-user-question-item">
          <div data-slot="ask-user-question-header">
            <span data-slot="ask-user-question-label">{question.header}</span>
          </div>
          <div data-slot="ask-user-question-text">{question.question}</div>
          <div data-slot="ask-user-question-options">
            <For each={question.options}>
              {(option) => (
                <Tooltip value={option.description} placement="top">
                  <button
                    type="button"
                    data-component="ask-user-chip"
                    data-selected={isSelected(questionIndex(), option.label)}
                    data-disabled={isSubmitting()}
                    onClick={() => toggleOption(questionIndex(), option.label, question.multiSelect)}
                  >
                    <Show when={isSelected(questionIndex(), option.label)}>
                      <Icon name="check-small" size="small" />
                    </Show>
                    <span>{option.label}</span>
                  </button>
                </Tooltip>
              )}
            </For>
          </div>
        </div>
      )}
    </For>
  )

  return (
    <div data-component="ask-user-question">
      {renderQuestions()}
      <Show when={hasSelections()}>
        <div data-slot="ask-user-submit">
          <Button variant="primary" size="small" onClick={handleSubmit} disabled={isSubmitting()}>
            <Show when={isSubmitting()} fallback="Submit">
              Submitting...
            </Show>
          </Button>
        </div>
      </Show>
    </div>
  )
}

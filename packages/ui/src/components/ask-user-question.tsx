import { Component, createMemo, createSignal, For, Show } from "solid-js"
import { Icon } from "./icon"
import { Spinner } from "./spinner"
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
  allowOther?: boolean
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
  // Track custom input for each question (when "Other" is selected)
  const [customInputs, setCustomInputs] = createSignal<Record<number, string>>({})
  // Track which questions have "Other" selected
  const [otherSelected, setOtherSelected] = createSignal<Record<number, boolean>>({})
  // Track submission state
  const [isSubmitting, setIsSubmitting] = createSignal(false)
  // Track current question index for tabs
  const [currentIndex, setCurrentIndex] = createSignal(0)

  // Don't render if already completed
  if (props.status === "completed" && props.output) {
    return null
  }

  const toggleOption = (questionIndex: number, optionLabel: string, multiSelect: boolean) => {
    if (isSubmitting()) return

    // If selecting a predefined option, deselect "Other" in single-select mode
    if (!multiSelect) {
      setOtherSelected((prev) => ({ ...prev, [questionIndex]: false }))
    }

    setSelections((prev) => {
      const current = prev[questionIndex] ?? []
      if (multiSelect) {
        if (current.includes(optionLabel)) {
          return { ...prev, [questionIndex]: current.filter((l) => l !== optionLabel) }
        }
        return { ...prev, [questionIndex]: [...current, optionLabel] }
      } else {
        return { ...prev, [questionIndex]: [optionLabel] }
      }
    })
  }

  const toggleOther = (questionIndex: number, multiSelect: boolean) => {
    if (isSubmitting()) return

    const isCurrentlySelected = otherSelected()[questionIndex] ?? false

    if (!multiSelect) {
      // Single select: deselect all predefined options when selecting Other
      if (!isCurrentlySelected) {
        setSelections((prev) => ({ ...prev, [questionIndex]: [] }))
      }
    }

    setOtherSelected((prev) => ({ ...prev, [questionIndex]: !isCurrentlySelected }))
  }

  const updateCustomInput = (questionIndex: number, value: string) => {
    setCustomInputs((prev) => ({ ...prev, [questionIndex]: value }))
  }

  const isSelected = (questionIndex: number, optionLabel: string) => {
    return (selections()[questionIndex] ?? []).includes(optionLabel)
  }

  const isOtherSelected = (questionIndex: number) => {
    return otherSelected()[questionIndex] ?? false
  }

  const getCustomInput = (questionIndex: number) => {
    return customInputs()[questionIndex] ?? ""
  }

  const handleSubmit = async () => {
    const request = pendingRequest()
    if (!request || !data.respondToAskUser || isSubmitting() || !hasSelections()) return

    setIsSubmitting(true)

    // Build answers object - map question text to selected labels + custom input
    const answers: Record<string, string> = {}
    questions().forEach((q, i) => {
      const selected = selections()[i] ?? []
      const hasOther = otherSelected()[i] ?? false
      const custom = customInputs()[i] ?? ""

      const parts: string[] = [...selected]
      if (hasOther && custom.trim()) {
        parts.push(custom.trim())
      }

      answers[q.question] = parts.join(", ")
    })

    try {
      await data.respondToAskUser({
        requestID: request.id,
        answers,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const hasSelections = () => {
    return questions().some((_, i) => {
      const hasSelected = (selections()[i] ?? []).length > 0
      const hasOther = otherSelected()[i] && (customInputs()[i] ?? "").trim().length > 0
      return hasSelected || hasOther
    })
  }

  const goToNext = () => {
    if (currentIndex() < questions().length - 1) {
      setCurrentIndex(currentIndex() + 1)
    }
  }

  const goToPrev = () => {
    if (currentIndex() > 0) {
      setCurrentIndex(currentIndex() - 1)
    }
  }

  const currentQuestion = () => questions()[currentIndex()]
  const hasMultipleQuestions = () => questions().length > 1

  const hasAnswer = (index: number) => {
    const hasSelected = (selections()[index] ?? []).length > 0
    const hasOther = otherSelected()[index] && (customInputs()[index] ?? "").trim().length > 0
    return hasSelected || hasOther
  }

  return (
    <div data-component="ask-user-question">
      {/* Tabs navigation for multiple questions */}
      <Show when={hasMultipleQuestions()}>
        <div data-slot="ask-user-tabs">
          <For each={questions()}>
            {(question, index) => (
              <button
                type="button"
                data-slot="ask-user-tab"
                data-active={index() === currentIndex()}
                data-has-selection={hasAnswer(index())}
                onClick={() => setCurrentIndex(index())}
              >
                <span data-slot="ask-user-tab-label">{question.header}</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Current question */}
      <Show when={currentQuestion()}>
        <div data-slot="ask-user-question-item">
          <Show when={!hasMultipleQuestions()}>
            <div data-slot="ask-user-question-header">
              <span data-slot="ask-user-question-label">{currentQuestion().header}</span>
            </div>
          </Show>
          <div data-slot="ask-user-question-text">{currentQuestion().question}</div>
          <div data-slot="ask-user-question-options">
            <For each={currentQuestion().options}>
              {(option) => (
                <button
                  type="button"
                  data-component="ask-user-chip"
                  data-selected={isSelected(currentIndex(), option.label)}
                  data-disabled={isSubmitting()}
                  onClick={() => toggleOption(currentIndex(), option.label, currentQuestion().multiSelect)}
                >
                  <div data-slot="ask-user-chip-content">
                    <span data-slot="ask-user-chip-label">{option.label}</span>
                    <Show when={option.description}>
                      <span data-slot="ask-user-chip-description">{option.description}</span>
                    </Show>
                  </div>
                </button>
              )}
            </For>

            {/* Other option with custom input */}
            <Show when={currentQuestion().allowOther !== false}>
              <div data-slot="ask-user-other-container">
                <button
                  type="button"
                  data-component="ask-user-chip"
                  data-selected={isOtherSelected(currentIndex())}
                  data-disabled={isSubmitting()}
                  onClick={() => toggleOther(currentIndex(), currentQuestion().multiSelect)}
                >
                  <div data-slot="ask-user-chip-content">
                    <span data-slot="ask-user-chip-label">Other</span>
                    <span data-slot="ask-user-chip-description">Provide custom response</span>
                  </div>
                </button>

                <Show when={isOtherSelected(currentIndex())}>
                  <input
                    type="text"
                    data-slot="ask-user-custom-input"
                    placeholder="Enter your response..."
                    value={getCustomInput(currentIndex())}
                    onInput={(e) => updateCustomInput(currentIndex(), e.currentTarget.value)}
                    disabled={isSubmitting()}
                  />
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* Footer with nav and submit */}
      <div data-slot="ask-user-footer">
        <Show when={hasMultipleQuestions()}>
          <div data-slot="ask-user-nav">
            <button
              type="button"
              data-slot="ask-user-nav-btn"
              data-direction="prev"
              onClick={goToPrev}
              disabled={currentIndex() === 0}
            >
              <Icon name="chevron-right" size="small" />
            </button>
            <span data-slot="ask-user-nav-indicator">
              {currentIndex() + 1} / {questions().length}
            </span>
            <button
              type="button"
              data-slot="ask-user-nav-btn"
              onClick={goToNext}
              disabled={currentIndex() === questions().length - 1}
            >
              <Icon name="chevron-right" size="small" />
            </button>
          </div>
        </Show>
        <button
          type="button"
          data-slot="ask-user-submit-btn"
          data-ready={hasSelections()}
          data-submitting={isSubmitting()}
          onClick={handleSubmit}
          disabled={isSubmitting() || !hasSelections()}
        >
          <Show when={isSubmitting()}>
            <Spinner />
          </Show>
          {isSubmitting() ? "Submitting..." : "Submit"}
        </button>
      </div>
    </div>
  )
}

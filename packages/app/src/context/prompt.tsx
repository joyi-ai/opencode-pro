import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createMemo, type Accessor } from "solid-js"
import { useParams } from "@solidjs/router"
import type { FileSelection } from "@/context/file"
import { Persist, persisted } from "@/utils/persist"

interface PartBase {
  content: string
  start: number
  end: number
}

export interface TextPart extends PartBase {
  type: "text"
}

export interface FileAttachmentPart extends PartBase {
  type: "file"
  path: string
  selection?: FileSelection
}

export interface AgentPart extends PartBase {
  type: "agent"
  name: string
}

export interface ImageAttachmentPart {
  type: "image"
  id: string
  filename: string
  mime: string
  dataUrl: string
}

export type ContentPart = TextPart | FileAttachmentPart | AgentPart | ImageAttachmentPart
export type Prompt = ContentPart[]

export type FileContextItem = {
  type: "file"
  path: string
  selection?: FileSelection
}

export type ContextItem = FileContextItem

export const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

function isSelectionEqual(a?: FileSelection, b?: FileSelection) {
  if (!a && !b) return true
  if (!a || !b) return false
  return (
    a.startLine === b.startLine && a.startChar === b.startChar && a.endLine === b.endLine && a.endChar === b.endChar
  )
}

export function isPromptEqual(promptA: Prompt, promptB: Prompt): boolean {
  if (promptA.length !== promptB.length) return false
  for (let i = 0; i < promptA.length; i++) {
    const partA = promptA[i]
    const partB = promptB[i]
    if (partA.type !== partB.type) return false
    if (partA.type === "text" && partA.content !== (partB as TextPart).content) {
      return false
    }
    if (partA.type === "file") {
      const fileA = partA as FileAttachmentPart
      const fileB = partB as FileAttachmentPart
      if (fileA.path !== fileB.path) return false
      if (!isSelectionEqual(fileA.selection, fileB.selection)) return false
    }
    if (partA.type === "agent" && partA.name !== (partB as AgentPart).name) {
      return false
    }
    if (partA.type === "image" && partA.id !== (partB as ImageAttachmentPart).id) {
      return false
    }
  }
  return true
}

function cloneSelection(selection?: FileSelection) {
  if (!selection) return undefined
  return { ...selection }
}

function clonePart(part: ContentPart): ContentPart {
  if (part.type === "text") return { ...part }
  if (part.type === "image") return { ...part }
  if (part.type === "agent") return { ...part }
  return {
    ...part,
    selection: cloneSelection(part.selection),
  }
}

function clonePrompt(prompt: Prompt): Prompt {
  return prompt.map(clonePart)
}

export const { use: usePrompt, provider: PromptProvider } = createSimpleContext<
  ReturnType<typeof createPromptContext>,
  { paneId?: string }
>({
  name: "Prompt",
  init: (props) => createPromptContext(() => props?.paneId),
})

type PromptEntry = {
  prompt: Prompt
  cursor?: number
  context: {
    activeTab: boolean
    items: (ContextItem & { key: string })[]
  }
}

type PromptStore = {
  entries: Record<string, PromptEntry>
}

function createDefaultEntry(): PromptEntry {
  return {
    prompt: clonePrompt(DEFAULT_PROMPT),
    cursor: undefined,
    context: {
      activeTab: true,
      items: [],
    },
  }
}

function normalizeEntry(entry: PromptEntry | undefined): PromptEntry {
  const fallback = createDefaultEntry()
  if (!entry) return fallback
  const prompt = Array.isArray(entry.prompt) ? entry.prompt : fallback.prompt
  const context = entry.context
  if (!context) {
    return {
      prompt,
      cursor: entry.cursor,
      context: {
        activeTab: fallback.context.activeTab,
        items: fallback.context.items,
      },
    }
  }
  const items = Array.isArray(context.items) ? context.items : fallback.context.items
  const activeTab = typeof context.activeTab === "boolean" ? context.activeTab : fallback.context.activeTab
  return {
    prompt,
    cursor: entry.cursor,
    context: {
      activeTab,
      items,
    },
  }
}

function keyForItem(item: ContextItem) {
  if (item.type !== "file") return item.type
  const start = item.selection?.startLine
  const end = item.selection?.endLine
  return `${item.type}:${item.path}:${start}:${end}`
}

function createPromptContext(paneId?: string | Accessor<string | undefined>) {
  const params = useParams()
  const getPaneId = typeof paneId === "function" ? paneId : () => paneId

  const [paneStore, setPaneStore] = createStore<PromptStore>({
    entries: {},
  })

  const key = createMemo(() => `${params.dir}/prompt${params.id ? "/" + params.id : ""}.v1`)
  const [store, setStore, _, ready] = persisted(
    "prompt.v2",
    createStore<PromptStore>({
      entries: {},
    }),
  )

  const currentEntry = createMemo(() => {
    const pane = getPaneId()
    if (pane) {
      return normalizeEntry(paneStore.entries[pane])
    }
    return normalizeEntry(store.entries[key()])
  })

  const updateEntry = (updater: (entry: PromptEntry) => PromptEntry) => {
    const pane = getPaneId()
    if (pane) {
      const base = normalizeEntry(paneStore.entries[pane])
      setPaneStore("entries", pane, updater(base))
      return
    }
    const next = updater(currentEntry())
    setStore("entries", key(), next)
  }

  const isReady = () => {
    if (getPaneId()) return true
    return ready()
  }

  return createPromptMethods(() => currentEntry(), updateEntry, isReady)
}

function createPromptMethods(
  getEntry: () => PromptEntry,
  updateEntry: (updater: (entry: PromptEntry) => PromptEntry) => void,
  ready: () => boolean,
) {
  const currentEntry = createMemo(() => getEntry())
  const currentPrompt = createMemo(() => currentEntry().prompt)
  return {
    ready,
    current: createMemo(() => currentPrompt()),
    cursor: createMemo(() => currentEntry().cursor),
    dirty: createMemo(() => !isPromptEqual(currentPrompt(), DEFAULT_PROMPT)),
    context: {
      activeTab: createMemo(() => currentEntry().context.activeTab),
      items: createMemo(() => currentEntry().context.items),
      addActive() {
        updateEntry((entry) => ({
          ...entry,
          context: { ...entry.context, activeTab: true },
        }))
      },
      removeActive() {
        updateEntry((entry) => ({
          ...entry,
          context: { ...entry.context, activeTab: false },
        }))
      },
      add(item: ContextItem) {
        const key = keyForItem(item)
        updateEntry((entry) => {
          if (entry.context.items.find((x) => x.key === key)) return entry
          return {
            ...entry,
            context: {
              ...entry.context,
              items: [...entry.context.items, { key, ...item }],
            },
          }
        })
      },
      remove(key: string) {
        updateEntry((entry) => ({
          ...entry,
          context: {
            ...entry.context,
            items: entry.context.items.filter((x) => x.key !== key),
          },
        }))
      },
    },
    set(prompt: Prompt, cursorPosition?: number) {
      const next = clonePrompt(prompt)
      batch(() => {
        updateEntry((entry) => ({
          ...entry,
          prompt: next,
          cursor: cursorPosition !== undefined ? cursorPosition : entry.cursor,
        }))
      })
    },
    reset() {
      batch(() => {
        updateEntry((entry) => ({
          ...entry,
          prompt: clonePrompt(DEFAULT_PROMPT),
          cursor: 0,
        }))
      })
    },
  }
}

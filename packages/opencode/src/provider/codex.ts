import type { Provider } from "./provider"
import { CodexAppServer } from "../codex/app-server"
import { Log } from "../util/log"

export namespace CodexProvider {
  const log = Log.create({ service: "codex-provider" })
  export const PROVIDER_ID = "codex"
  const RELEASE_DATE = "2025-01-01"

  const BASE_CAPABILITIES: Provider.Model["capabilities"] = {
    temperature: false,
    reasoning: true,
    attachment: true,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: true,
      video: false,
      pdf: true,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: true,
  }

  function readString(input: unknown): string | undefined {
    return typeof input === "string" ? input : undefined
  }

  function readBoolean(input: unknown): boolean | undefined {
    return typeof input === "boolean" ? input : undefined
  }

  function readArray(input: unknown): unknown[] {
    return Array.isArray(input) ? input : []
  }

  function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === "object" && input !== null
  }

  function normalizeEffort(input: string): string {
    return input.toLowerCase().replace(/[^a-z]/g, "")
  }

  const effortOrder = ["minimal", "low", "medium", "high", "xhigh"]

  function sortEfforts(input: string[]) {
    const order = new Map(effortOrder.map((value, index) => [value, index]))
    return input.slice().sort((a, b) => {
      const aIndex = order.get(a) ?? effortOrder.length
      const bIndex = order.get(b) ?? effortOrder.length
      if (aIndex === bIndex) return a.localeCompare(b)
      return aIndex - bIndex
    })
  }

  function readEfforts(input: unknown): string[] {
    const result: string[] = []
    for (const entry of readArray(input)) {
      if (typeof entry === "string") {
        result.push(normalizeEffort(entry))
        continue
      }
      if (!isRecord(entry)) continue
      const raw = readString(entry.reasoningEffort) ?? readString(entry.reasoning_effort)
      if (!raw) continue
      result.push(normalizeEffort(raw))
    }
    return result
  }

  function resolveModelID(input: Record<string, unknown>): string | undefined {
    const model = readString(input.model)
    if (model) return model
    const id = readString(input.id)
    if (id) return id
    return undefined
  }

  function resolveModelName(input: Record<string, unknown>, fallback: string): string {
    const display = readString(input.displayName) ?? readString(input.display_name) ?? readString(input.displayname)
    if (display) return display
    return fallback
  }

  export async function account() {
    const response = await CodexAppServer.account().catch(() => undefined)
    if (!response || !isRecord(response)) return undefined
    return {
      account: isRecord(response.account) ? response.account : undefined,
      requiresOpenaiAuth: readBoolean(response.requiresOpenaiAuth) ?? false,
    }
  }

  export async function listModels() {
    const data = await CodexAppServer.modelList().catch(() => [] as Record<string, unknown>[])
    const models: Record<string, Provider.Model> = {}

    for (const item of data) {
      if (!item || typeof item !== "object") continue
      const record = item as Record<string, unknown>
      const id = resolveModelID(record)
      if (!id) continue
      const name = resolveModelName(record, id)
      const efforts = readEfforts(record.supportedReasoningEfforts ?? record.supported_reasoning_efforts)
      const supported =
        efforts.length > 0 ? sortEfforts(Array.from(new Set(efforts))) : sortEfforts(["low", "medium", "high"])
      const variants = Object.fromEntries(supported.map((effort) => [effort, { reasoningEffort: effort }]))
      models[id] = {
        id,
        providerID: PROVIDER_ID,
        name,
        family: "codex",
        api: { id, url: "", npm: "@ai-sdk/openai-compatible" },
        capabilities: BASE_CAPABILITIES,
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: 200000, output: 16000 },
        status: "active",
        options: {},
        headers: {},
        release_date: RELEASE_DATE,
        variants,
      }
    }

    if (Object.keys(models).length === 0) {
      log.warn("no codex models found")
    }

    return models
  }
}

import { MessageV2 } from "./message-v2"
import { Session } from "."
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { PermissionNext } from "../permission/next"
import { SessionStatus } from "./status"
import { CodexAppServer, type Request as CodexRequest } from "../codex/app-server"
import { CodexSession } from "../codex/session"
import { SystemPrompt } from "./system"
import type { Agent } from "../agent/agent"
import type { Provider } from "../provider/provider"
import path from "path"
import { createTwoFilesPatch } from "diff"
import { fileURLToPath } from "url"

type DiffCount = { additions: number; deletions: number }

type ChangeSummary = DiffCount & {
  file: string
  kind: string
  diff: string
}

type ProcessContext = {
  sessionID: string
  messageID: string
  threadID: string
  turnID?: string
  turnStatus?: string
  turnError?: string
  turnErrorInfo?: string
  textParts: Map<string, MessageV2.TextPart>
  reasoningParts: Map<string, MessageV2.ReasoningPart>
  toolParts: Map<string, MessageV2.ToolPart>
  commandOutput: Map<string, string>
  fileOutput: Map<string, string>
  tokens?: MessageV2.Assistant["tokens"]
  permissions: PermissionNext.Ruleset
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null
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

function createDeferred<T>() {
  const holder: { resolve?: (value: T) => void } = {}
  const promise = new Promise<T>((resolve) => {
    holder.resolve = resolve
  })
  return { promise, resolve: holder.resolve! }
}

function relativePattern(input: string) {
  if (path.isAbsolute(input)) return path.relative(Instance.worktree, input)
  return input
}

function countDiff(diff: string): DiffCount {
  return diff.split("\n").reduce(
    (acc, line) => {
      const isAdd = line.startsWith("+") && !line.startsWith("+++")
      const isDel = line.startsWith("-") && !line.startsWith("---")
      if (isAdd) acc.additions += 1
      if (isDel) acc.deletions += 1
      return acc
    },
    { additions: 0, deletions: 0 },
  )
}

function formatChangeDiff(change: Record<string, unknown>, kind: string) {
  const diff = readString(change.diff) ?? ""
  const file = readString(change.path) ?? "file"
  if (kind === "add") return createTwoFilesPatch(file, file, "", diff)
  if (kind === "delete") return createTwoFilesPatch(file, file, diff, "")
  return diff
}

function summarizeChanges(changes: Record<string, unknown>[]) {
  const summaries: ChangeSummary[] = []
  for (const change of changes) {
    if (!isRecord(change)) continue
    const file = readString(change.path)
    if (!file) continue
    const kindValue = change.kind
    const kind =
      typeof kindValue === "string"
        ? kindValue
        : (readString(isRecord(kindValue) ? kindValue.type : undefined) ?? "update")
    const diff = formatChangeDiff(change, kind)
    const counts = countDiff(diff)
    summaries.push({
      file,
      kind,
      diff,
      additions: counts.additions,
      deletions: counts.deletions,
    })
  }
  return summaries
}

function aggregateDiff(changes: ChangeSummary[]) {
  return changes
    .map((change) => change.diff)
    .join("\n\n")
    .trim()
}

function summarizeInput(changes: ChangeSummary[]) {
  return changes.map((change) => change.file)
}

function toolStart(state: MessageV2.ToolPart["state"]) {
  if (state.status === "pending") return Date.now()
  return state.time.start
}

function extractCommand(item: Record<string, unknown>) {
  const command = readString(item.command)
  return command ?? ""
}

function extractCwd(item: Record<string, unknown>) {
  const cwd = readString(item.cwd)
  return cwd ?? ""
}

export namespace CodexProcessor {
  const log = Log.create({ service: "codex-processor" })

  export interface ProcessInput {
    sessionID: string
    assistantMessage: MessageV2.Assistant
    prompt: string
    agent: Agent.Info
    abort: AbortSignal
    model: Provider.Model
    sessionPermission?: PermissionNext.Ruleset
    user: MessageV2.User
    images?: string[]
  }

  async function ensureThread(input: ProcessInput, instructions: string) {
    const existing = await CodexSession.getThreadID(input.sessionID)
    if (existing) {
      const resumed = await CodexAppServer.threadResume(existing).catch(() => undefined)
      const thread = resumed && isRecord(resumed.thread) ? resumed.thread : undefined
      const threadID = thread ? readString(thread.id) : undefined
      if (threadID) return threadID
    }

    const params: Record<string, unknown> = {
      model: input.model.id,
      cwd: Instance.directory,
      approvalPolicy: "on-request",
    }
    if (instructions) params.developerInstructions = instructions
    const created = await CodexAppServer.threadStart(params)
    const thread = created.thread
    const threadID = isRecord(thread) ? readString(thread.id) : undefined
    if (!threadID) throw new Error("codex app-server did not return a thread id")
    await CodexSession.setThreadID(input.sessionID, threadID)
    return threadID
  }

  async function buildInstructions(input: ProcessInput) {
    const custom = await SystemPrompt.custom()
    const environment = await SystemPrompt.environment()
    const agent = input.agent.prompt ? [input.agent.prompt] : []
    const user = input.user.system ? [input.user.system] : []
    const system = [...agent, ...environment, ...custom, ...user]
    return system.filter(Boolean).join("\n")
  }

  function resolvePermissionRules(input: ProcessInput) {
    return PermissionNext.merge(input.agent.permission, input.sessionPermission ?? [])
  }

  function resolveReasoningEffort(input: ProcessInput) {
    const variant = input.user.variant
    if (!variant) return undefined
    const variants = input.model.variants
    if (!variants || !variants[variant]) return undefined
    return variant
  }

  async function ensureAccount(input: ProcessInput) {
    const response = await CodexAppServer.account().catch(() => undefined)
    if (!response || !isRecord(response)) return
    const requiresAuth = readBoolean(response.requiresOpenaiAuth)
    if (requiresAuth !== true) return
    const account = response.account
    if (isRecord(account)) return
    throw new MessageV2.AuthError({
      providerID: input.model.providerID,
      message: "Codex login required. Connect with ChatGPT or an API key.",
    })
  }

  async function handleCommandApproval(ctx: ProcessContext, message: CodexRequest, item: Record<string, unknown>) {
    const command = extractCommand(item)
    const cwd = extractCwd(item)
    const patterns = command ? [command] : ["*"]
    const metadata = { command, cwd, reason: message.params?.reason }
    const decision = await PermissionNext.ask({
      sessionID: ctx.sessionID,
      permission: "bash",
      patterns,
      always: patterns,
      metadata,
      tool: {
        messageID: ctx.messageID,
        callID: readString(message.params?.itemId) ?? "",
      },
      ruleset: ctx.permissions,
    })
      .then(() => "accept")
      .catch((error) => {
        if (error instanceof PermissionNext.RejectedError) return "decline"
        return "cancel"
      })

    await CodexAppServer.respond(message.id, { decision })
    return true
  }

  async function handleFileApproval(ctx: ProcessContext, message: CodexRequest, changes: ChangeSummary[]) {
    const paths = changes.map((change) => relativePattern(change.file))
    const patterns = paths.length > 0 ? paths : ["*"]
    const metadata = { diff: aggregateDiff(changes) }
    const decision = await PermissionNext.ask({
      sessionID: ctx.sessionID,
      permission: "edit",
      patterns,
      always: patterns,
      metadata,
      tool: {
        messageID: ctx.messageID,
        callID: readString(message.params?.itemId) ?? "",
      },
      ruleset: ctx.permissions,
    })
      .then(() => "accept")
      .catch((error) => {
        if (error instanceof PermissionNext.RejectedError) return "decline"
        return "cancel"
      })

    await CodexAppServer.respond(message.id, { decision })
    return true
  }

  async function handleApproval(ctx: ProcessContext, message: CodexRequest) {
    if (
      message.method !== "item/commandExecution/requestApproval" &&
      message.method !== "item/fileChange/requestApproval"
    )
      return false
    const params = message.params
    if (!isRecord(params)) return false
    const itemId = readString(params.itemId)
    if (!itemId) return false
    const tool = ctx.toolParts.get(itemId)
    if (!tool) {
      await CodexAppServer.respond(message.id, { decision: "cancel" })
      return true
    }
    const metadata = tool.state.status === "running" ? tool.state.metadata : undefined
    const item = isRecord(metadata) ? (metadata.item as Record<string, unknown> | undefined) : undefined
    if (message.method === "item/commandExecution/requestApproval") {
      const commandItem = item ?? {}
      return handleCommandApproval(ctx, message, commandItem)
    }
    const changeList = metadata?.changes
    const summaries = Array.isArray(changeList) ? changeList : summarizeChanges([])
    return handleFileApproval(ctx, message, summaries as ChangeSummary[])
  }

  function updateCommandOutput(ctx: ProcessContext, itemId: string, delta: string) {
    const existing = ctx.commandOutput.get(itemId) ?? ""
    ctx.commandOutput.set(itemId, existing + delta)
  }

  function updateFileOutput(ctx: ProcessContext, itemId: string, delta: string) {
    const existing = ctx.fileOutput.get(itemId) ?? ""
    ctx.fileOutput.set(itemId, existing + delta)
  }

  async function startCommandPart(ctx: ProcessContext, item: Record<string, unknown>) {
    const itemId = readString(item.id)
    if (!itemId) return
    const command = extractCommand(item)
    const toolPart: MessageV2.ToolPart = {
      id: Identifier.ascending("part"),
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      type: "tool",
      callID: itemId,
      tool: "bash",
      state: {
        status: "running",
        input: { command, description: command },
        time: {
          start: Date.now(),
        },
        metadata: {
          item,
        },
      },
    }
    ctx.toolParts.set(itemId, toolPart)
    await Session.updatePart(toolPart)
  }

  async function startFilePart(ctx: ProcessContext, item: Record<string, unknown>) {
    const itemId = readString(item.id)
    if (!itemId) return
    const changeInput = readArray(item.changes).filter(isRecord) as Record<string, unknown>[]
    const summaries = summarizeChanges(changeInput)
    const toolPart: MessageV2.ToolPart = {
      id: Identifier.ascending("part"),
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      type: "tool",
      callID: itemId,
      tool: "patch",
      state: {
        status: "running",
        input: { files: summarizeInput(summaries) },
        time: {
          start: Date.now(),
        },
        metadata: {
          changes: summaries,
          diff: aggregateDiff(summaries),
          item,
        },
      },
    }
    ctx.toolParts.set(itemId, toolPart)
    await Session.updatePart(toolPart)
  }

  async function completeCommandPart(ctx: ProcessContext, item: Record<string, unknown>) {
    const itemId = readString(item.id)
    if (!itemId) return
    const existing = ctx.toolParts.get(itemId)
    if (!existing) return
    const start = toolStart(existing.state)
    const command = extractCommand(item)
    const output = readString(item.aggregatedOutput) ?? ctx.commandOutput.get(itemId) ?? ""
    const status = readString(item.status)
    if (status && status.toLowerCase() !== "completed") {
      const errorPart: MessageV2.ToolPart = {
        ...existing,
        state: {
          status: "error",
          input: existing.state.input,
          error: `Command ${status}`,
          time: {
            start,
            end: Date.now(),
          },
        },
      }
      await Session.updatePart(errorPart)
      return
    }
    const completedPart: MessageV2.ToolPart = {
      ...existing,
      state: {
        status: "completed",
        input: existing.state.input,
        output,
        title: command || "command",
        metadata: {
          command,
          cwd: extractCwd(item),
          exitCode: item.exitCode,
        },
        time: {
          start,
          end: Date.now(),
        },
      },
    }
    await Session.updatePart(completedPart)
  }

  async function completeFilePart(ctx: ProcessContext, item: Record<string, unknown>) {
    const itemId = readString(item.id)
    if (!itemId) return
    const existing = ctx.toolParts.get(itemId)
    if (!existing) return
    const start = toolStart(existing.state)
    const changeInput = readArray(item.changes).filter(isRecord) as Record<string, unknown>[]
    const summaries = summarizeChanges(changeInput)
    const diff = aggregateDiff(summaries)
    const status = readString(item.status)
    if (status && status.toLowerCase() !== "completed") {
      const errorPart: MessageV2.ToolPart = {
        ...existing,
        state: {
          status: "error",
          input: existing.state.input,
          error: `File change ${status}`,
          time: {
            start,
            end: Date.now(),
          },
        },
      }
      await Session.updatePart(errorPart)
      return
    }
    const completedPart: MessageV2.ToolPart = {
      ...existing,
      state: {
        status: "completed",
        input: existing.state.input,
        output: diff,
        title: `${summaries.length} files`,
        metadata: {
          changes: summaries,
          diff,
          output: ctx.fileOutput.get(itemId),
        },
        time: {
          start,
          end: Date.now(),
        },
      },
    }
    await Session.updatePart(completedPart)
  }

  async function startTextPart(ctx: ProcessContext, item: Record<string, unknown>) {
    const itemId = readString(item.id)
    if (!itemId) return
    const text = readString(item.text) ?? ""
    const part: MessageV2.TextPart = {
      id: Identifier.ascending("part"),
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      type: "text",
      text,
      time: {
        start: Date.now(),
      },
    }
    ctx.textParts.set(itemId, part)
    await Session.updatePart(part)
  }

  async function startReasoningPart(ctx: ProcessContext, item: Record<string, unknown>) {
    const itemId = readString(item.id)
    if (!itemId) return
    const summary = readArray(item.summary)
      .map((entry) => readString(entry))
      .filter(Boolean)
      .join("\n")
    const content = readArray(item.content)
      .map((entry) => readString(entry))
      .filter(Boolean)
      .join("\n")
    const text = summary || content
    const part: MessageV2.ReasoningPart = {
      id: Identifier.ascending("part"),
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      type: "reasoning",
      text,
      time: {
        start: Date.now(),
      },
    }
    ctx.reasoningParts.set(itemId, part)
    await Session.updatePart(part)
  }

  async function completeTextPart(ctx: ProcessContext, item: Record<string, unknown>) {
    const itemId = readString(item.id)
    if (!itemId) return
    const part = ctx.textParts.get(itemId)
    if (!part) return
    const text = readString(item.text)
    if (text !== undefined) part.text = text
    const start = part.time?.start ?? Date.now()
    part.time = {
      start,
      end: Date.now(),
    }
    await Session.updatePart(part)
  }

  async function completeReasoningPart(ctx: ProcessContext, item: Record<string, unknown>) {
    const itemId = readString(item.id)
    if (!itemId) return
    const part = ctx.reasoningParts.get(itemId)
    if (!part) return
    const summary = readArray(item.summary)
      .map((entry) => readString(entry))
      .filter(Boolean)
      .join("\n")
    const content = readArray(item.content)
      .map((entry) => readString(entry))
      .filter(Boolean)
      .join("\n")
    const text = summary || content
    if (text) part.text = text
    part.time = {
      ...part.time,
      end: Date.now(),
    }
    await Session.updatePart(part)
  }

  async function handleItemStarted(ctx: ProcessContext, params: Record<string, unknown>) {
    const item = isRecord(params.item) ? params.item : undefined
    if (!item) return
    const type = readString(item.type)
    if (type === "agentMessage") {
      await startTextPart(ctx, item)
      return
    }
    if (type === "reasoning") {
      await startReasoningPart(ctx, item)
      return
    }
    if (type === "commandExecution") {
      await startCommandPart(ctx, item)
      return
    }
    if (type === "fileChange") {
      await startFilePart(ctx, item)
    }
  }

  async function handleItemCompleted(ctx: ProcessContext, params: Record<string, unknown>) {
    const item = isRecord(params.item) ? params.item : undefined
    if (!item) return
    const type = readString(item.type)
    if (type === "agentMessage") {
      await completeTextPart(ctx, item)
      return
    }
    if (type === "reasoning") {
      await completeReasoningPart(ctx, item)
      return
    }
    if (type === "commandExecution") {
      await completeCommandPart(ctx, item)
      return
    }
    if (type === "fileChange") {
      await completeFilePart(ctx, item)
    }
  }

  async function handleAgentDelta(ctx: ProcessContext, params: Record<string, unknown>) {
    const itemId = readString(params.itemId)
    const delta = readString(params.delta)
    if (!itemId || !delta) return
    const part = ctx.textParts.get(itemId)
    if (!part) return
    part.text += delta
    await Session.updatePart({ part, delta })
  }

  async function handleReasoningDelta(ctx: ProcessContext, params: Record<string, unknown>) {
    const itemId = readString(params.itemId)
    const delta = readString(params.delta)
    if (!itemId || !delta) return
    const part = ctx.reasoningParts.get(itemId)
    if (!part) return
    part.text += delta
    await Session.updatePart({ part, delta })
  }

  async function handleCommandOutputDelta(ctx: ProcessContext, params: Record<string, unknown>) {
    const itemId = readString(params.itemId)
    const delta = readString(params.delta)
    if (!itemId || !delta) return
    updateCommandOutput(ctx, itemId, delta)
  }

  async function handleFileOutputDelta(ctx: ProcessContext, params: Record<string, unknown>) {
    const itemId = readString(params.itemId)
    const delta = readString(params.delta)
    if (!itemId || !delta) return
    updateFileOutput(ctx, itemId, delta)
  }

  async function handleTokenUsage(ctx: ProcessContext, params: Record<string, unknown>) {
    const usage = isRecord(params.tokenUsage) ? params.tokenUsage : undefined
    if (!usage) return
    const last = isRecord(usage.last) ? usage.last : undefined
    if (!last) return
    const input = Number(last.inputTokens ?? 0)
    const output = Number(last.outputTokens ?? 0)
    const cached = Number(last.cachedInputTokens ?? 0)
    const reasoning = Number(last.reasoningOutputTokens ?? 0)
    ctx.tokens = {
      input,
      output,
      reasoning,
      cache: { read: cached, write: 0 },
    }
  }

  async function handleNotification(
    ctx: ProcessContext,
    params: Record<string, unknown>,
    method: string,
    done: () => void,
  ) {
    if (method === "turn/started") {
      const turn = isRecord(params.turn) ? params.turn : undefined
      const turnId = turn ? readString(turn.id) : undefined
      if (turnId) ctx.turnID = turnId
    }
    if (method === "turn/completed") {
      const turn = isRecord(params.turn) ? params.turn : undefined
      const status = turn ? readString(turn.status) : undefined
      if (status) ctx.turnStatus = status.toLowerCase()
      const error = turn && isRecord(turn.error) ? turn.error : undefined
      const message = error ? readString(error.message) : undefined
      if (message) ctx.turnError = message
      const info = error ? readString(error.codexErrorInfo) : undefined
      if (info) ctx.turnErrorInfo = info
      done()
    }
    if (method === "error") {
      const error = isRecord(params.error) ? params.error : undefined
      const message = error ? readString(error.message) : undefined
      if (message) ctx.turnError = message
      const info = error ? readString(error.codexErrorInfo) : undefined
      if (info) ctx.turnErrorInfo = info
      const willRetry = readBoolean(params.willRetry)
      if (willRetry === false) ctx.turnStatus = "failed"
    }
    if (method === "item/started") {
      await handleItemStarted(ctx, params)
    }
    if (method === "item/completed") {
      await handleItemCompleted(ctx, params)
    }
    if (method === "item/agentMessage/delta") {
      await handleAgentDelta(ctx, params)
    }
    if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
      await handleReasoningDelta(ctx, params)
    }
    if (method === "item/commandExecution/outputDelta") {
      await handleCommandOutputDelta(ctx, params)
    }
    if (method === "item/fileChange/outputDelta") {
      await handleFileOutputDelta(ctx, params)
    }
    if (method === "thread/tokenUsage/updated") {
      await handleTokenUsage(ctx, params)
    }
  }

  export async function process(input: ProcessInput): Promise<{
    finish: string
    cost: number
    tokens: MessageV2.Assistant["tokens"]
  }> {
    log.info("starting codex process", {
      sessionID: input.sessionID,
      modelID: input.model.id,
    })

    const subscriptions = {
      notification: () => {},
      request: () => {},
      exit: () => {},
    }
    const abortSubscription = {
      handler: () => {},
    }
    const cleanup = () => {
      input.abort.removeEventListener("abort", abortSubscription.handler)
      subscriptions.notification()
      subscriptions.request()
      subscriptions.exit()
      SessionStatus.set(input.sessionID, { type: "idle" })
    }

    const run = async (instructionsOverride?: string) => {
      SessionStatus.set(input.sessionID, { type: "busy" })
      const instructions = instructionsOverride ?? (await buildInstructions(input))
      const threadID = await ensureThread(input, instructions)
      const ctx: ProcessContext = {
        sessionID: input.sessionID,
        messageID: input.assistantMessage.id,
        threadID,
        textParts: new Map(),
        reasoningParts: new Map(),
        toolParts: new Map(),
        commandOutput: new Map(),
        fileOutput: new Map(),
        permissions: resolvePermissionRules(input),
      }

      const done = createDeferred<void>()
      subscriptions.notification = CodexAppServer.onNotification((message) => {
        const params = message.params
        if (!isRecord(params)) return
        const threadId = readString(params.threadId)
        if (threadId && threadId !== ctx.threadID) return
        void handleNotification(ctx, params, message.method, () => done.resolve())
      })

      subscriptions.request = CodexAppServer.onRequest(async (message) => {
        const params = message.params
        if (!isRecord(params)) return false
        const threadId = readString(params.threadId)
        if (threadId && threadId !== ctx.threadID) return false
        return handleApproval(ctx, message)
      })
      subscriptions.exit = CodexAppServer.onExit((error) => {
        if (ctx.turnStatus) return
        if (input.abort.aborted) {
          ctx.turnStatus = "interrupted"
          done.resolve()
          return
        }
        ctx.turnStatus = "failed"
        ctx.turnError = error.message
        done.resolve()
      })

      const abortHandler = () => {
        const turnId = ctx.turnID
        if (turnId) {
          void CodexAppServer.turnInterrupt({ threadId: ctx.threadID, turnId })
        }
      }
      abortSubscription.handler = abortHandler
      input.abort.addEventListener("abort", abortHandler, { once: true })

      const result = {
        finish: "end_turn",
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      }

      await ensureAccount(input)
      const textInput = { type: "text", text: input.prompt }
      const imageInputs = (input.images ?? [])
        .filter((image) => image.length > 0)
        .map((image) =>
          image.startsWith("file:")
            ? {
                type: "localImage",
                path: fileURLToPath(image),
              }
            : {
                type: "image",
                url: image,
              },
        )
      const inputs = [textInput, ...imageInputs]
      const response = await CodexAppServer.turnStart({
        threadId: ctx.threadID,
        input: inputs,
        cwd: Instance.directory,
        approvalPolicy: "on-request",
        sandboxPolicy: {
          type: "externalSandbox",
          networkAccess: "enabled",
        },
        model: input.model.id,
        effort: resolveReasoningEffort(input),
      })
      const turn = isRecord(response.turn) ? response.turn : undefined
      const turnId = turn ? readString(turn.id) : undefined
      if (turnId) ctx.turnID = turnId

      await done.promise

      if (ctx.tokens) result.tokens = ctx.tokens
      const status = (ctx.turnStatus ?? "completed").toLowerCase()
      if (status === "failed") {
        const message = ctx.turnError ?? "Codex turn failed"
        const errorInfo = (ctx.turnErrorInfo ?? "").toLowerCase()
        if (errorInfo === "unauthorized") {
          throw new MessageV2.AuthError({ providerID: input.model.providerID, message })
        }
        throw new Error(message)
      }
      if (status === "interrupted") result.finish = "interrupted"
      return result
    }

    const attempt = (instructionsOverride?: string) => run(instructionsOverride).finally(cleanup)
    return attempt().catch(async (error) => {
      if (!(error instanceof Error)) throw error
      const message = error.message.toLowerCase()
      if (!message.includes("instructions are not valid")) throw error
      log.warn("codex instructions rejected, retrying without developer instructions", {
        sessionID: input.sessionID,
      })
      await CodexSession.clearThreadID(input.sessionID)
      return attempt("")
    })
  }
}

import path from "path"
import { Global } from "@/global"
import { Log } from "@/util/log"

/**
 * JSONL transcript recording for Claude Code compatibility
 */
export namespace ClaudePluginTranscript {
  const log = Log.create({ service: "claude-plugin.transcript" })

  export interface TranscriptEntry {
    type: "tool_use" | "tool_result" | "user" | "assistant"
    timestamp: string
    tool_name?: string
    tool_input?: Record<string, unknown>
    tool_output?: Record<string, unknown>
    tool_use_id?: string
    error?: string
    content?: string
  }

  // Session ID -> file path mapping (in-memory cache)
  const transcriptPaths = new Map<string, string>()

  /**
   * Get the transcript directory path
   */
  function getTranscriptDir(): string {
    return path.join(Global.Path.home, ".claude", "transcripts")
  }

  /**
   * Ensure the transcript directory exists
   */
  async function ensureDir(): Promise<void> {
    const dir = getTranscriptDir()
    await Bun.file(path.join(dir, ".keep")).writer().end()
  }

  /**
   * Get transcript file path for a session
   */
  export function getPath(sessionID: string): string {
    if (transcriptPaths.has(sessionID)) {
      return transcriptPaths.get(sessionID)!
    }

    const filepath = path.join(getTranscriptDir(), `${sessionID}.jsonl`)
    transcriptPaths.set(sessionID, filepath)
    return filepath
  }

  /**
   * Append an entry to the transcript file
   */
  export async function append(sessionID: string, entry: TranscriptEntry): Promise<void> {
    const filepath = getPath(sessionID)
    const line = JSON.stringify(entry) + "\n"

    try {
      const file = Bun.file(filepath)
      const exists = await file.exists()

      if (exists) {
        const current = await file.text()
        await Bun.write(filepath, current + line)
      } else {
        await ensureDir()
        await Bun.write(filepath, line)
      }
    } catch (error) {
      log.warn("failed to write transcript entry", {
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Record a tool use event
   */
  export async function recordToolUse(input: {
    sessionID: string
    toolName: string
    toolInput: Record<string, unknown>
    toolUseId: string
  }): Promise<void> {
    await append(input.sessionID, {
      type: "tool_use",
      timestamp: new Date().toISOString(),
      tool_name: input.toolName,
      tool_input: input.toolInput,
      tool_use_id: input.toolUseId,
    })
    log.info("recorded tool_use", { sessionID: input.sessionID, toolName: input.toolName })
  }

  /**
   * Record a tool result event
   */
  export async function recordToolResult(input: {
    sessionID: string
    toolName: string
    toolOutput: Record<string, unknown>
    toolUseId: string
    error?: string
  }): Promise<void> {
    await append(input.sessionID, {
      type: "tool_result",
      timestamp: new Date().toISOString(),
      tool_name: input.toolName,
      tool_output: input.toolOutput,
      tool_use_id: input.toolUseId,
      error: input.error,
    })
    log.info("recorded tool_result", {
      sessionID: input.sessionID,
      toolName: input.toolName,
      hasError: !!input.error,
    })
  }

  /**
   * Record a user message
   */
  export async function recordUserMessage(input: { sessionID: string; content: string }): Promise<void> {
    await append(input.sessionID, {
      type: "user",
      timestamp: new Date().toISOString(),
      content: input.content,
    })
  }

  /**
   * Record an assistant message
   */
  export async function recordAssistantMessage(input: { sessionID: string; content: string }): Promise<void> {
    await append(input.sessionID, {
      type: "assistant",
      timestamp: new Date().toISOString(),
      content: input.content,
    })
  }

  /**
   * Clear the transcript path cache for a session
   */
  export function clearCache(sessionID: string): void {
    transcriptPaths.delete(sessionID)
  }
}

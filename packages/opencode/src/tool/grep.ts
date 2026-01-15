import z from "zod"
import { Tool } from "./tool"
import { Ripgrep } from "../file/ripgrep"

import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"
import path from "path"
import { assertExternalDirectory } from "./external-directory"

const MAX_LINE_LENGTH = 2000

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
  }),
  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }

    await ctx.ask({
      permission: "grep",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
        include: params.include,
      },
    })

    let searchPath = params.path ?? Instance.directory
    searchPath = path.isAbsolute(searchPath) ? searchPath : path.resolve(Instance.directory, searchPath)
    await assertExternalDirectory(ctx, searchPath, { kind: "directory" })

    const rgPath = await Ripgrep.filepath()
    const args = ["-nH", "--hidden", "--follow", "--field-match-separator=|", "--regexp", params.pattern]
    if (params.include) {
      args.push("--glob", params.include)
    }
    args.push(searchPath)

    const proc = Bun.spawn([rgPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const limit = 100
    const matches: { path: string; lineNum: number; lineText: string }[] = []
    const state = {
      buffer: "",
      truncated: false,
    }

    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()

    while (!state.truncated) {
      const result = await reader.read()
      if (result.done) break

      state.buffer += decoder.decode(result.value, { stream: true })
      const parts = state.buffer.split("\n")
      state.buffer = parts.pop() ?? ""

      for (const part of parts) {
        const line = part.endsWith("\r") ? part.slice(0, -1) : part
        if (!line) continue

        const [filePath, lineNumStr, ...lineTextParts] = line.split("|")
        if (!filePath || !lineNumStr || lineTextParts.length === 0) continue

        const lineNum = parseInt(lineNumStr, 10)
        const lineText = lineTextParts.join("|")

        matches.push({
          path: filePath,
          lineNum,
          lineText,
        })

        if (matches.length >= limit) {
          state.truncated = true
          break
        }
      }
    }

    if (state.truncated) {
      await reader.cancel()
    }
    reader.releaseLock()

    const errorOutput = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode === 1 && matches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    if (exitCode !== 0 && !state.truncated) {
      throw new Error(`ripgrep failed: ${errorOutput}`)
    }

    const truncated = state.truncated

    if (matches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    const outputLines = [`Found ${matches.length} matches`]

    const current = { value: "" }
    for (const match of matches) {
      if (current.value !== match.path) {
        if (current.value !== "") {
          outputLines.push("")
        }
        current.value = match.path
        outputLines.push(`${match.path}:`)
      }
      const truncatedLineText =
        match.lineText.length > MAX_LINE_LENGTH ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." : match.lineText
      outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)
    }

    if (truncated) {
      outputLines.push("")
      outputLines.push("(Results are truncated. Consider using a more specific path or pattern.)")
    }

    return {
      title: params.pattern,
      metadata: {
        matches: matches.length,
        truncated,
      },
      output: outputLines.join("\n"),
    }
  },
})

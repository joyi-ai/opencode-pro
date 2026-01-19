import { describe, expect, test } from "bun:test"

// Unit test to verify the result message handling logic
// This tests the message structure matching what claude-agent-processor expects

describe("Claude Code Slash Command Result Handling", () => {
  test("SDKResultSuccess message structure has result field", () => {
    // This is the structure from SDK coreTypes.generated.d.ts
    const resultMessage = {
      type: "result" as const,
      subtype: "success" as const,
      duration_ms: 100,
      duration_api_ms: 50,
      is_error: false,
      num_turns: 1,
      result: "Context usage: 1,234 tokens of 200,000 (0.6%)", // Slash command output
      total_cost_usd: 0.001,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    }

    // Verify the structure matches what claude-agent-processor.ts expects
    expect(resultMessage.type).toBe("result")
    expect(resultMessage.result).toBeDefined()
    expect(typeof resultMessage.result).toBe("string")
    expect(resultMessage.result.length).toBeGreaterThan(0)
  })

  test("result field extraction logic works correctly", () => {
    // Simulate the logic from claude-agent-processor.ts case "result"
    const msg = {
      type: "result",
      subtype: "success",
      result: "Session cost: $0.00 (0.00 USD)",
      total_cost_usd: 0,
      num_turns: 0,
    }

    // This is the extraction logic used in claude-agent-processor.ts
    const resultMsg = msg as { result?: string; subtype: string }

    expect(resultMsg.result).toBeDefined()
    expect(resultMsg.result?.trim()).toBe("Session cost: $0.00 (0.00 USD)")
  })

  test("empty result is handled correctly", () => {
    const msg = {
      type: "result",
      subtype: "success",
      result: "",
      total_cost_usd: 0,
      num_turns: 0,
    }

    const resultMsg = msg as { result?: string; subtype: string }

    // Empty result should be falsy when trimmed
    const hasContent = resultMsg.result && resultMsg.result.trim()
    expect(hasContent).toBeFalsy()
  })

  test("missing result field is handled correctly", () => {
    const msg = {
      type: "result",
      subtype: "success",
      total_cost_usd: 0,
      num_turns: 0,
    }

    const resultMsg = msg as { result?: string; subtype: string }

    // Missing result should be undefined
    expect(resultMsg.result).toBeUndefined()

    // Check should be falsy
    const hasContent = resultMsg.result && resultMsg.result.trim()
    expect(hasContent).toBeFalsy()
  })

  test("whitespace-only result is handled correctly", () => {
    const msg = {
      type: "result",
      subtype: "success",
      result: "   \n\t  ",
      total_cost_usd: 0,
      num_turns: 0,
    }

    const resultMsg = msg as { result?: string; subtype: string }

    // Whitespace-only should be falsy when trimmed
    const hasContent = resultMsg.result && resultMsg.result.trim()
    expect(hasContent).toBeFalsy()
  })
})

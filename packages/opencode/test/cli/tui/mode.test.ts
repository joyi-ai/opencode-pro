import { describe, expect, test } from "bun:test"
import {
  BUILTIN_MODES,
  DEFAULT_MODE_ID,
  filterAgents,
  isAvailable,
  missingPlugins,
} from "../../../src/cli/cmd/tui/mode"

describe("tui modes", () => {
  test("includes default mode", () => {
    const ids = BUILTIN_MODES.map((m) => m.id)
    expect(ids).toContain(DEFAULT_MODE_ID)
  })

  test("oh-my-opencode requires plugin (config)", () => {
    const mode = BUILTIN_MODES.find((m) => m.id === "oh-my-opencode")
    expect(mode).toBeTruthy()
    const missing = missingPlugins(mode!, { plugins: [], agentNames: new Set() })
    expect(missing).toEqual(["oh-my-opencode"])
    expect(isAvailable(mode!, { plugins: [], agentNames: new Set() })).toBe(false)
  })

  test("oh-my-opencode treated as available when Sisyphus agent exists", () => {
    const mode = BUILTIN_MODES.find((m) => m.id === "oh-my-opencode")
    expect(mode).toBeTruthy()
    const missing = missingPlugins(mode!, { plugins: [], agentNames: new Set(["Sisyphus"]) })
    expect(missing).toEqual([])
    expect(isAvailable(mode!, { plugins: [], agentNames: new Set(["Sisyphus"]) })).toBe(true)
  })

  test("claude-code mode restricts agents to build/plan", () => {
    const mode = BUILTIN_MODES.find((m) => m.id === "claude-code")
    expect(mode).toBeTruthy()
    const agents = [{ name: "build" }, { name: "plan" }, { name: "explore" }]
    const filtered = filterAgents(agents, mode!)
    expect(filtered.map((a) => a.name)).toEqual(["build", "plan"])
  })

  test("opencode mode hides oh-my-opencode specialist agents", () => {
    const mode = BUILTIN_MODES.find((m) => m.id === "opencode")
    expect(mode).toBeTruthy()
    const agents = [{ name: "build" }, { name: "Sisyphus" }, { name: "oracle" }, { name: "explore" }]
    const filtered = filterAgents(agents, mode!)
    expect(filtered.map((a) => a.name)).toEqual(["build", "explore"])
  })

  test("oh-my-opencode mode disables build/plan by default", () => {
    const mode = BUILTIN_MODES.find((m) => m.id === "oh-my-opencode")
    expect(mode).toBeTruthy()
    const agents = [
      { name: "build" },
      { name: "plan" },
      { name: "Sisyphus" },
      { name: "OpenCode-Builder" },
      { name: "Planner-Sisyphus" },
    ]
    const filtered = filterAgents(agents, mode!)
    expect(filtered.map((a) => a.name)).toEqual(["Sisyphus", "Planner-Sisyphus"])
  })
})

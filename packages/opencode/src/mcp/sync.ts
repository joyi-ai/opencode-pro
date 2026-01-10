import path from "path"
import fs from "fs/promises"
import { Config } from "@/config/config"
import { Global } from "@/global"

export namespace McpSync {
  type McpEntry = NonNullable<Config.Info["mcp"]>[string]

  export type ExternalServer =
    | {
        type?: "stdio"
        command: string
        args?: string[]
        env?: Record<string, string>
      }
    | {
        type: "http" | "sse"
        url: string
        headers?: Record<string, string>
      }

  type SyncState = {
    names: string[]
  }

  function isConfigured(entry: McpEntry): entry is Config.Mcp {
    if (!entry) return false
    if (typeof entry !== "object") return false
    if (!("type" in entry)) return false
    return true
  }

  function readRecord(input: unknown): Record<string, unknown> {
    if (!input) return {}
    if (typeof input !== "object") return {}
    if (Array.isArray(input)) return {}
    return input as Record<string, unknown>
  }

  function readStringArray(input: unknown): string[] {
    if (!Array.isArray(input)) return []
    return input.filter((item): item is string => typeof item === "string")
  }

  async function readJson(filepath: string): Promise<Record<string, unknown>> {
    const text = await Bun.file(filepath)
      .text()
      .catch(() => undefined)
    if (!text) return {}
    const parsed = await Promise.resolve()
      .then(() => JSON.parse(text) as unknown)
      .catch(() => undefined)
    if (!parsed) return {}
    return readRecord(parsed)
  }

  async function writeJson(filepath: string, data: Record<string, unknown>) {
    await fs.mkdir(path.dirname(filepath), { recursive: true })
    await Bun.write(filepath, JSON.stringify(data, null, 2))
  }

  export function toExternalServers(mcp: Config.Info["mcp"] | undefined): Record<string, ExternalServer> {
    const result: Record<string, ExternalServer> = {}
    const entries = Object.entries(mcp ?? {})

    for (const [name, entry] of entries) {
      if (!isConfigured(entry)) continue
      if (entry.enabled === false) continue
      if (entry.type === "local") {
        const command = entry.command[0] ?? ""
        const args = entry.command.slice(1)
        const env = entry.environment
        const local: ExternalServer = {
          type: "stdio",
          command,
          ...(args.length > 0 ? { args } : {}),
          ...(env ? { env } : {}),
        }
        result[name] = local
        continue
      }
      if (entry.type === "remote") {
        const headers = entry.headers
        const remote: ExternalServer = {
          type: "http",
          url: entry.url,
          ...(headers ? { headers } : {}),
        }
        result[name] = remote
      }
    }

    return result
  }

  async function updateSettings(filepath: string, servers: Record<string, ExternalServer>, remove: string[]) {
    const data = await readJson(filepath)
    const existing = readRecord(data.mcpServers)
    const next = { ...existing }

    for (const name of remove) {
      delete next[name]
    }
    for (const [name, server] of Object.entries(servers)) {
      next[name] = server
    }

    await writeJson(filepath, { ...data, mcpServers: next })
  }

  function statePath() {
    return path.join(Global.Path.data, "mcp-sync.json")
  }

  export async function apply(mcp: Config.Info["mcp"] | undefined, directory: string) {
    const servers = toExternalServers(mcp)
    const state = await readJson(statePath())
    const previous = readStringArray(state.names)
    const current = Object.keys(servers)
    const currentSet = new Set(current)
    const remove = previous.filter((name) => !currentSet.has(name))

    const claudePath = path.join(directory, ".claude", "settings.json")
    const codexPath = path.join(Global.Path.data, "codex", "settings.json")

    const shouldWrite = current.length > 0 || remove.length > 0
    if (shouldWrite) {
      await Promise.all([updateSettings(claudePath, servers, remove), updateSettings(codexPath, servers, remove)])
    }

    const nextState: SyncState = {
      names: current.sort(),
    }
    await writeJson(statePath(), nextState)
  }
}

import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"
import { ClaudePluginSchema } from "./schema"

export namespace ClaudePluginStorage {
  const log = Log.create({ service: "claude-plugin.storage" })

  const STORAGE_KEY = ["claude-plugin"]

  /**
   * List all installed plugins
   */
  export async function list(): Promise<ClaudePluginSchema.InstalledPlugin[]> {
    const keys = await Storage.list(STORAGE_KEY)
    const plugins: ClaudePluginSchema.InstalledPlugin[] = []

    for (const key of keys) {
      const plugin = await Storage.read<ClaudePluginSchema.InstalledPlugin>(key).catch(() => undefined)
      if (plugin) {
        const parsed = ClaudePluginSchema.InstalledPlugin.safeParse(plugin)
        if (parsed.success) {
          plugins.push(parsed.data)
        } else {
          log.warn("invalid stored plugin", { key, issues: parsed.error.issues })
        }
      }
    }

    return plugins
  }

  /**
   * Get a specific installed plugin by ID
   */
  export async function get(id: string): Promise<ClaudePluginSchema.InstalledPlugin | undefined> {
    const plugin = await Storage.read<ClaudePluginSchema.InstalledPlugin>([...STORAGE_KEY, id]).catch(() => undefined)
    if (!plugin) return undefined

    const parsed = ClaudePluginSchema.InstalledPlugin.safeParse(plugin)
    return parsed.success ? parsed.data : undefined
  }

  /**
   * Save/update an installed plugin
   */
  export async function save(plugin: ClaudePluginSchema.InstalledPlugin): Promise<void> {
    await Storage.write([...STORAGE_KEY, plugin.id], plugin)
    log.info("saved plugin", { id: plugin.id })
  }

  /**
   * Remove an installed plugin
   */
  export async function remove(id: string): Promise<void> {
    await Storage.remove([...STORAGE_KEY, id])
    log.info("removed plugin", { id })
  }

  /**
   * Enable or disable a plugin
   */
  export async function setEnabled(
    id: string,
    enabled: boolean,
  ): Promise<ClaudePluginSchema.InstalledPlugin | undefined> {
    const updated = await Storage.update<ClaudePluginSchema.InstalledPlugin>([...STORAGE_KEY, id], (draft) => {
      draft.enabled = enabled
      draft.updatedAt = Date.now()
    }).catch(() => undefined)

    if (updated) {
      log.info("updated plugin enabled status", { id, enabled })
    }

    return updated
  }

  /**
   * Check if a plugin is installed
   */
  export async function isInstalled(id: string): Promise<boolean> {
    const plugin = await get(id)
    return plugin !== undefined
  }

  /**
   * Check if a plugin is enabled
   */
  export async function isEnabled(id: string): Promise<boolean> {
    const plugin = await get(id)
    return plugin?.enabled ?? false
  }
}

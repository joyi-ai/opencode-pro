import { cmd } from "@/cli/cmd/cmd"
import { Instance } from "@/project/instance"
import path from "path"
import { fileURLToPath } from "url"
import { Server } from "@/server/server"
import { upgrade } from "@/cli/upgrade"
import { withNetworkOptions, resolveNetworkOptions } from "@/cli/network"

export const TuiSpawnCommand = cmd({
  command: "spawn [project]",
  builder: (yargs) =>
    withNetworkOptions(yargs).positional("project", {
      type: "string",
      describe: "path to start opencode in",
    }),
  handler: async (args) => {
    upgrade()
    const opts = await resolveNetworkOptions(args)
    const server = Server.listen(opts)
    const bin = process.execPath
    const cmd = []
    let cwd = process.cwd()
    if (bin.endsWith("bun") || bin.endsWith("bun.exe")) {
      const indexPath = fileURLToPath(new URL("../../../index.ts", import.meta.url))
      const cwdPath = fileURLToPath(new URL("../../../../", import.meta.url))
      cmd.push(process.execPath, "run", "--conditions", "browser", indexPath)
      cwd = cwdPath
    } else cmd.push(process.execPath)
    cmd.push("attach", server.url.toString(), "--dir", args.project ? path.resolve(args.project) : process.cwd())
    const proc = Bun.spawn({
      cmd,
      cwd,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      env: {
        ...process.env,
        BUN_OPTIONS: "",
      },
    })
    await proc.exited
    await Instance.disposeAll()
    await server.stop(true)
  },
})

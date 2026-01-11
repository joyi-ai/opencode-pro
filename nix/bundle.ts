#!/usr/bin/env bun

import path from "path"
import fs from "fs"

const dir = process.cwd()
const version = process.env.OPENCODE_VERSION ?? "local"
const channel = process.env.OPENCODE_CHANNEL ?? "local"

fs.rmSync(path.join(dir, "dist"), { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  sourcemap: "none",
  tsconfig: "./tsconfig.json",
  define: {
    OPENCODE_VERSION: `'${version}'`,
    OPENCODE_CHANNEL: `'${channel}'`,
  },
})

if (!result.success) {
  console.error("bundle failed")
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

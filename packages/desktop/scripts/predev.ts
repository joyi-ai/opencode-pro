import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

// Kill any running opencode-cli processes on Windows to prevent "Access is denied" errors
// when copying the sidecar binary
async function killOpencodeCli() {
  if (process.platform !== "win32") return

  try {
    // Find and kill opencode-cli processes
    await $`powershell -Command "Get-Process -Name 'opencode-cli' -ErrorAction SilentlyContinue | Stop-Process -Force"`.quiet()
    console.log("Killed existing opencode-cli processes")
  } catch {
    // No processes to kill, that's fine
  }
}

await killOpencodeCli()

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

const binaryPath = windowsify(`../opencode/dist/${sidecarConfig.ocBinary}/bin/opencode`)

await $`cd ../opencode && bun run build --single`

await copyBinaryToSidecarFolder(binaryPath, RUST_TARGET)

import path from "path"
import fs from "fs"

const version = "@VERSION@"
const pkg = path.join(process.cwd(), "packages/opencode")
const target = process.env["BUN_COMPILE_TARGET"]

if (!target) {
  throw new Error("BUN_COMPILE_TARGET not set")
}

process.chdir(pkg)

const manifestName = "opencode-assets.manifest"
const manifestPath = path.join(pkg, manifestName)

const readTrackedAssets = () => {
  if (!fs.existsSync(manifestPath)) return []
  return fs
    .readFileSync(manifestPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

const removeTrackedAssets = () => {
  for (const file of readTrackedAssets()) {
    const filePath = path.join(pkg, file)
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true })
    }
  }
}

const assets = new Set<string>()

const addAsset = async (p: string) => {
  const file = path.basename(p)
  const dest = path.join(pkg, file)
  await Bun.write(dest, Bun.file(p))
  assets.add(file)
}

removeTrackedAssets()

const result = await Bun.build({
  conditions: ["browser"],
  tsconfig: "./tsconfig.json",
  sourcemap: "external",
  entrypoints: ["./src/index.ts"],
  define: {
    OPENCODE_VERSION: `'@VERSION@'`,
    OPENCODE_CHANNEL: "'latest'",
  },
  compile: {
    target,
    outfile: "opencode",
    autoloadBunfig: false,
    autoloadDotenv: false,
    //@ts-ignore (bun types aren't up to date)
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    execArgv: ["--user-agent=opencode/" + version, "--use-system-ca", "--"],
    windows: {},
  },
})

if (!result.success) {
  console.error("Build failed!")
  for (const log of result.logs) {
    console.error(log)
  }
  throw new Error("Compilation failed")
}

const assetOutputs = result.outputs?.filter((x) => x.kind === "asset") ?? []
for (const x of assetOutputs) {
  await addAsset(x.path)
}

const list = Array.from(assets)
await Bun.write(manifestPath, list.length > 0 ? list.join("\n") + "\n" : "")

console.log("Build successful!")

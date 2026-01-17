# AGENTS.md

Brief, repo-wide guidance for Codex.

## Global Instructions
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- Default branch is `main`.

## Gotchas (keep updated)
- Windows path issues: run `bun test` from WSL/Linux.
- Changing server endpoints in `packages/opencode/src/server/server.ts` requires
  SDK regeneration.

---

## Workflows

### Install
- `bun install`

### Dev and Run
- Desktop app (repo root): `bun run tauri dev`
- OpenCode server (packages/opencode): `bun run --conditions=browser ./src/index.ts`
- OpenCode dev loop (packages/opencode): `bun dev`

### Typecheck
- `bun turbo typecheck`
- `cd packages/opencode && bun run typecheck`

### Tests (Bun)
- `cd packages/opencode && bun test`
- `bun test <file>`
- `bun test --coverage`
- On Windows: run tests from WSL/Linux.

### SDK Regeneration
- `bun ./script/generate.ts` (repo root)
- `bun ./packages/sdk/js/script/build.ts` (repo root)

---

## Architecture

OpenCode uses a client-server architecture centered on the desktop app.

### Core Packages
- `packages/opencode`: core server and business logic
- `packages/desktop`: Tauri desktop app (main UI)
- `packages/app`: shared SolidJS app components
- `packages/ui`: shared UI component library
- `packages/sdk/js`: generated TypeScript SDK
- `packages/plugin`: `@opencode-ai/plugin` for custom tools

### Server Layout (packages/opencode/src)
- `agent/`: agent definitions and prompts
- `provider/`: AI provider abstraction
- `tool/`: built-in tools
- `session/`: sessions, messages, compaction
- `permission/`: tool permission system
- `mcp/`: Model Context Protocol client
- `lsp/`: Language Server Protocol integration
- `config/`: configuration loading
- `bus/`: event bus (pub-sub)
- `server/`: Hono REST API + SSE

### Agent System
- Built-in agents: `build`, `plan`, `explore`, `general`
- Custom agents: `.opencode/agent/*.md` or `opencode.json`

---

## Code Style

### General
- Keep logic in single functions unless reusable.
- Avoid `else`, `try/catch`, `let`, and `any`.
- Prefer single-word variable names when descriptive.
- Use Bun APIs (`Bun.file()`, `Bun.$`, etc.).
- No unnecessary destructuring.

### Conventions
- Namespace modules via `export namespace Foo { ... }`.
- Use Zod schemas for validation and SDK generation.
- Path alias `@/` maps to `src/`.
- Prompts are stored as `.txt` and imported as strings.
- Use `lazy()` for deferred expensive operations.

### Imports
- For local modules in `packages/opencode`, prefer relative imports and named
  imports.

---

## Testing

Uses Bun's test runner (`bun:test`). Tests live in `packages/opencode/test/`.

### Running
- `cd packages/opencode && bun test`
- `bun test <file>`
- `bun test --coverage`
- On Windows: run tests from WSL/Linux.

### Fixture Example
```ts
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"

test("example", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // test code runs in isolated project context
    },
  })
})
```

### Tool Context Example
```ts
const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}
```

---

## Frontend

### SolidJS
- Prefer `createStore` over multiple `createSignal` calls.

### UI Debugging
- The app is already running at http://localhost:3000.

---

## OpenCode Server (packages/opencode)

### Tools
- Tools use Zod schemas and `Tool.define(...)`.
- `execute(args, ctx)` should use `ctx.ask()` for permissions and
  `ctx.metadata()` for UI updates.
- Avoid throwing exceptions in tools; use Result patterns.
- Tools should implement `Tool.Info` with an `execute()` method.

### Context and DI
- Pass `sessionID` in tool context.
- Use `App.provide()` for dependency injection.

### Logging and Storage
- Use `Log.create({ service: "name" })`.
- Use the `Storage` namespace for persistence.

### SDK
- If you change server endpoints, regenerate the SDK with
  `bun ./script/generate.ts`.

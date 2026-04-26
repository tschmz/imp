# AGENTS.md

Quick repo map for getting into the code. Prefer `src/` over generated `dist/`.

- Commit messages must follow `type: summary`, for example `feat: add status endpoint`.
- Do not use Conventional Commit scopes in this repository, for example use `feat: add status endpoint`, not `feat(cli): add status endpoint`.
- Before a commit that includes changes under `src/`, run `npm run check` and `npm test`, and do not commit unless both pass.
- The project is early-stage: prefer clear CLI commands over backward-compatibility aliases or shims when the design improves.

## First files to inspect
- `package.json`: npm scripts and CLI bin (`imp -> ./dist/main.js`)
- `src/main.ts`: executable entry point; wires CLI commands to application use cases
- `src/cli/create-cli.ts`: top-level CLI definition
- `src/cli/commands/*.ts`: command group registration for `config`, `skills`, `backup`, `plugin`, and `service`
- `src/application/runtime-target.ts`: config discovery + runtime/service target resolution
- `src/daemon/create-daemon.ts`: daemon assembly and runtime validation
- `src/daemon/bootstrap/*`: runtime bootstrap steps

## Runtime flow
- CLI entry: `src/main.ts` -> `src/cli/*`
- User-facing operations: `src/application/*`
- Config loading and normalization: `src/config/*`
- Daemon/runtime lifecycle: `src/daemon/*`
- Agent execution, tool resolution, prompts, MCP integration: `src/runtime/*`
- Endpoint transport creation and normalization: `src/transports/*`

## Main source areas
- `src/application/`: use cases for daemon startup, chat, config, backups, plugins, services, and inbound command handling
- `src/cli/`: Commander-based CLI and command registration
- `src/config/`: config discovery, init flow, schema, loading, and runtime resolution
- `src/daemon/`: runtime bootstrap, runner, shutdown, and state handling
- `src/domain/`: core agent, conversation, message, and error types
- `src/runtime/`: PI agent engine wiring, model/prompt/tool resolution, built-in tools, MCP runtime
- `src/transports/`: transport registry plus built-in `cli`, `telegram`, and `file` transports
- `src/plugins/`: plugin manifest/discovery/protocol support
- `src/skills/`: skill discovery and catalog merging
- `src/service/`: install/manage/uninstall background services across platforms
- `src/storage/`: filesystem-backed persistence
- `src/logging/`: file loggers and log viewing
- `src/files/`: file/archive helpers used by backups and managed files
- `src/extensions/`: extension hooks
- `src/agents/`: built-in prompt and agent registry
- `src/tools/`: tool registry types

## Public/package entry points
- `src/index.ts`: exports `createDaemon`, daemon types, and plugin discovery/manifest APIs
- `assets/agents/default-system-prompt.md`: bundled default system prompt
- `config.example.json`: example app config
- `plugins/`: bundled installable plugins

## Tests
- Unit tests live next to source files as `*.test.ts`
- CLI end-to-end coverage is in `src/main.e2e.test.ts`

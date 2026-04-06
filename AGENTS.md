# AGENTS.md

- Commit messages must follow the Conventional Commits format, for example `feat: add status endpoint`.
- Before a commit that includes changes under `src/`, run `npm run check` and `npm test`, and do not commit unless both pass.
- The project is early-stage: prefer clear CLI commands over backward-compatibility aliases or shims when the design improves.

## Repo Snapshot

### Top level
- `package.json`: npm package metadata, scripts, and the CLI bin mapping `imp -> ./dist/main.js`.
- `README.md`: user-facing overview, install flow, config/init/start/service usage.
- `config.example.json`: example runtime configuration.
- `src/`: TypeScript source.
- `docs/`: user and developer docs.
- `dist/`: built output.

### Runtime and CLI entry points
- `src/main.ts`: main executable entry point. Wires CLI commands to app logic, starts the daemon, handles `init`, `log`, `config`, and `service` subcommands.
- `src/cli/create-cli.ts`: defines the full command surface:
  - `imp start`
  - `imp log`
  - `imp init`
  - `imp config validate|get|set|reload`
  - `imp service install|uninstall|start|stop|restart|status`
- `src/index.ts`: library export surface; currently exports `createDaemon` and daemon types.
- `package.json` scripts:
  - `npm run build` -> compile to `dist/`
  - `npm test` -> Vitest
  - `npm run check` -> typecheck + lint
  - `npm start` -> `node dist/main.js`

### Main source areas under `src/`
- `agents/`: built-in system prompt and agent registry.
- `application/`: message handling orchestration.
- `cli/`: Commander-based CLI definition.
- `config/`: config discovery, prompting, schema validation, defaults, initialization, and runtime resolution.
- `daemon/`: daemon construction, lifecycle, and runtime state.
- `domain/`: core domain types for agents, conversations, and messages.
- `files/`: managed-file helpers.
- `logging/`: file logger and log viewing.
- `runtime/`: runtime context, PI agent engine setup, OAuth/API-key resolution.
- `service/`: service install/manage/uninstall logic and install-plan rendering.
- `storage/`: filesystem-backed persistence.
- `tools/`: tool registry types and wiring.
- `transports/telegram/`: Telegram transport and Telegram message rendering.
- `transports/types.ts`: transport interfaces.

### Main integration boundaries
- `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-coding-agent`: model/provider and agent runtime integration.
- `grammy`: Telegram transport integration.
- Linux/macOS service managers via `src/service/*`.

### Test layout
- Unit tests live next to modules as `*.test.ts`.
- Top-level end-to-end coverage is in `src/main.e2e.test.ts`.
- Service behavior has dedicated tests under `src/service/`.
- Telegram rendering and transport behavior have dedicated tests under `src/transports/telegram/`.

### First files to inspect for most tasks
- CLI/runtime flow: `package.json`, `src/main.ts`, `src/cli/create-cli.ts`
- Config loading and resolution: `src/config/*`
- Daemon lifecycle: `src/daemon/create-daemon.ts`
- Agent runtime wiring: `src/runtime/create-pi-agent-engine.ts`
- Service generation/management: `src/service/install-plan.ts`, `src/service/install-service.ts`, `src/service/manage-service.ts`
- Telegram behavior: `src/transports/telegram/telegram-transport.ts`, `src/transports/telegram/render-telegram-message.ts`

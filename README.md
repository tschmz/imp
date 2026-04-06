# imp

`imp` is a local daemon for running agent-based bots as persistent services.

It manages agent configuration and runtime state on disk, starts configured bots, and connects them
to transports such as Telegram.

## Features

- Run one or more named agents from a single local daemon
- Route bot messages to specific agents
- Persist runtime state and logs on disk
- Configure models and providers through `@mariozechner/pi-ai`
- Bootstrap a starter config with `imp init`

## Quickstart

### Requirements

- Node.js 20.6 or newer
- Credentials for at least one supported model provider
- A Telegram bot token if you want to use the Telegram transport

### Install

```bash
npm install -g @tschmz/imp
```

### Create a config

```bash
imp init
```

`imp init` runs an interactive setup wizard. For a non-interactive starter config, use:

```bash
imp init --defaults
```

Both variants create a starter `SYSTEM.md` under the configured `dataRoot` and wire the
default agent to that `prompt.base.file`.
Interactive setup can also store an optional per-agent shell `PATH` for the `bash` tool without
polluting the service-wide environment.

You can also inspect
[`config.example.json`](./config.example.json) for a more complete example.

### Start the daemon

```bash
imp start
```

Or with an explicit config path:

```bash
imp start --config /path/to/config.json
```

### Install as a user service

```bash
imp service install
```

On Linux, `imp service install` and `imp init` now install a user systemd unit together with a
managed environment file for service-level credentials. Interactive
`imp init` also prompts for provider-specific service credentials such as `OPENAI_API_KEY` and
stores them in that managed environment file so the user service can start independently of your
login shell.

When your shell environment changes, refresh the installed service with:

```bash
imp service install --force
```

That regenerates both the unit and the managed environment file without requiring manual edits to
`~/.config/systemd/user/imp.service`. Existing custom variables from the managed environment file
are preserved across `--force` reinstalls unless you replace them through `imp init`.
On Linux, that managed environment file lives next to the config as `~/.config/imp/service.env`.

### Create a backup

```bash
imp backup create
```

By default this writes a tar archive next to the active config and includes:

- the active config file
- agent prompt/auth files referenced from the config
- bot conversation stores under `paths.dataRoot`

If a referenced prompt or auth file is missing, backup creation fails with a targeted error that
identifies the agent reference and path instead of producing a partial archive.

You can scope the archive with `--only`, for example:

```bash
imp backup create --only conversations
imp backup create --only config,agents --output /tmp/imp-backup.tar
```

### Restore a backup

```bash
imp restore /path/to/imp-backup.tar --force
```

For a bare restore into a new installation, pass an explicit target config path and data root:

```bash
imp restore /path/to/imp-backup.tar \
  --config /path/to/config.json \
  --data-root /path/to/data-root \
  --force
```

`imp restore` only rewrites the selected backup scopes. Conversation restores replace only the
targeted `bots/<id>/conversations` subtree and leave unrelated data under `paths.dataRoot`
untouched.

`--only agents` is intentionally stricter: it is only valid when you also restore `config`, or
when `--config` points to an already existing target config file. This prevents restoring relative
prompt/auth files into an undefined layout.

## How It Works

`imp` runs as a local daemon. It loads a JSON configuration, resolves agent and bot definitions,
initializes transports, and keeps runtime state under a local data root.

Each bot can be routed to a default agent. Each agent can define:

- a model provider and model ID
- tool access
- a workspace with working directory and shell PATH
- a prompt with a base prompt, instructions, and references
- provider-specific inference settings

## Configuration

A minimal config contains:

- `instance` for instance metadata
- `paths.dataRoot` for runtime state and logs
- `defaults.agentId` for the fallback agent
- `agents` for one or more named agent definitions
- `bots` for one or more bot/transports

See [`config.example.json`](./config.example.json) for a full example.

## Providers

`imp` uses the provider registry from [`@mariozechner/pi-ai`](https://www.npmjs.com/package/@mariozechner/pi-ai),
so the exact list of supported providers depends on the installed `pi-ai` version.

See [Supported providers](./docs/providers.md) for the current provider list and credential requirements.

## Bots and Transports

Currently supported transport types:

- `telegram`

A Telegram bot definition includes:

- a bot token
- allowed user IDs
- optional default agent routing

Telegram bots automatically register their command menus on startup. The built-in commands include:

- `/help`
- `/whoami`
- `/new`
- `/rename <title>`
- `/clear`
- `/status`
- `/history`
- `/restore <n>`
- `/export`
- `/ping`
- `/config`
- `/agent`
- `/agent <id>`
- `/logs`
- `/logs <lines>`
- `/reload`
- `/restart`

See [Telegram commands](./docs/telegram.md) for the command behavior details.

## Data and Logs

Runtime data is stored under `paths.dataRoot`.

This includes persisted bot state and daemon log files written during startup and runtime.

## Development

```bash
npm install
npm run check
npm test
npm run build
```

## Documentation

- [Documentation index](./docs/index.md)
- [Supported providers](./docs/providers.md)

# Imp

Imp is a local daemon for running personal AI agents. It lets you configure multiple agents with their own models, prompts, workspaces, tools, and skills, then reach them from the terminal, Telegram, or local plugin endpoints.

The project is designed for users who want useful AI assistants in familiar places while keeping runtime configuration, sessions, logs, backups, and integrations under local control.

## Contents

- [What Imp Does](#what-imp-does)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quickstart](#quickstart)
- [Core Concepts](#core-concepts)
- [CLI Overview](#cli-overview)
- [Configuration](#configuration)
- [Telegram, Plugins, and Services](#telegram-plugins-and-services)
- [Development](#development)
- [Documentation](#documentation)
- [License](#license)

## What Imp Does

- **Multiple agents**: Give each agent its own model, instructions, reference files, skills, tools, and workspace.
- **Multiple entry points**: Use a local terminal chat, private Telegram bots, or file-based plugin endpoints with the same daemon.
- **Persistent sessions**: Resume, rename, export, or reset conversations without losing local history.
- **Controlled tool access**: Enable built-in tools, MCP servers, and delegated agents per agent.
- **Local runtime state**: Keep configuration, agent files, logs, and conversations in local paths you control.
- **Operational commands**: Validate config, reload services, inspect logs, create backups, restore archives, and manage background services from the CLI.

## Requirements

- Node.js **20.6 or newer**
- npm
- Credentials for at least one supported model provider

For example, when using OpenAI:

```sh
export OPENAI_API_KEY="your-api-key"
```

See [Providers](./docs/providers.md) for supported providers and their required environment variables.

## Installation

Install the CLI globally with npm:

```sh
npm install -g @tschmz/imp
```

Verify that the command is available:

```sh
imp --version
```

## Quickstart

Create an initial configuration:

```sh
imp init
```

Start a local terminal chat:

```sh
imp chat
```

Send a message. When the agent replies, your local Imp setup is working. Use `/help` inside the chat to view available chat commands.

To run enabled daemon endpoints such as Telegram or file-based plugin endpoints, start the daemon:

```sh
imp start
```

## Core Concepts

### Agents

An agent defines how Imp talks to a model. An agent can configure:

- provider and model ID
- model credentials and inference settings
- system prompt, additional instructions, and reference context
- workspace and shell path
- enabled built-in tools, MCP servers, skills, and delegated agents

Read more in [Agent Context](./docs/agent-context.md) and [Agent Tools](./docs/agent-tools.md).

### Endpoints

Endpoints receive messages and deliver replies. The main endpoint types are:

- `cli`: an interactive local chat started with `imp chat`
- `telegram`: a private Telegram bot with an allowlist
- `file`: a file-based inbox/outbox flow for local plugins

### Configuration

Imp uses a JSON configuration file. It resolves the active config in this order:

1. `--config /path/to/config.json`
2. `IMP_CONFIG_PATH`
3. `XDG_CONFIG_HOME/imp/config.json`
4. `~/.config/imp/config.json`
5. `/etc/imp/config.json`

See [`config.example.json`](./config.example.json) for a complete example.

## CLI Overview

| Command                            | Purpose                                             |
| ---------------------------------- | --------------------------------------------------- |
| `imp init`                         | Create an initial config interactively              |
| `imp chat`                         | Start a local terminal chat                         |
| `imp start`                        | Start enabled daemon endpoints                      |
| `imp log`                          | Show daemon logs                                    |
| `imp config get <path>`            | Read an effective config value                      |
| `imp config set <path> <value>`    | Update a config value                               |
| `imp config validate [--preflight]` | Validate the active config and optional agent preflight |
| `imp config reload`                | Ask the installed service to reload                 |
| `imp backup create`                | Create a backup archive                             |
| `imp restore <archive>`            | Restore from a backup archive                       |
| `imp plugin list`                  | List installable plugins                            |
| `imp plugin install <id-or-spec>`  | Install a plugin into the config                    |
| `imp service install`              | Install a background service definition             |
| `imp skills sync-managed`          | Refresh managed skills from the installed package   |

Most commands that operate on an installation accept `--config` to target a specific config file.

## Configuration

Use the CLI for day-to-day config inspection and updates:

```sh
imp config get defaults.agentId
imp config set logging.level debug
imp config validate
imp config validate --preflight
```

Use `--preflight` to also resolve runtime agent config, tools, and prompt files before starting a chat or daemon endpoint.

Pass arrays and objects as JSON:

```sh
imp config set agents.default.tools '["read","bash","edit","write","grep","find","ls","update_plan"]'
```

Relative paths in the config are resolved from the config file directory, not from the shell directory where you run `imp`.

Read more in [Configuration](./docs/configuration.md).

## Telegram, Plugins, and Services

### Telegram

Telegram endpoints require a bot token and an allowlist of Telegram user IDs. Tokens can be configured inline, through an environment variable, or through a secret file reference.

```sh
imp config set endpoints.private-telegram.token '{"env":"IMP_TELEGRAM_BOT_TOKEN"}'
imp config set endpoints.private-telegram.access.allowedUserIds '["123456789"]'
imp config validate
imp start
```

Read more in [Telegram](./docs/telegram.md).

### Plugins

Plugins are local companion components. They can contribute installable endpoints, services, MCP server defaults, specialized agents, skills, and trusted JS runtime tools.

```sh
imp plugin list
imp plugin inspect <plugin-id>
imp plugin install <plugin-id-or-npm-spec>
imp plugin doctor <plugin-id>
```

Read more in [Plugins](./docs/plugins.md) and [plugins/README.md](./plugins/README.md).

### Background Service

Imp can be installed and managed as a background service:

```sh
imp service install
imp service start
imp service status
imp service restart
imp service stop
```

Make sure provider credentials and other required environment variables are available to the service process, not only to your interactive shell.

## Development

Clone the repository and install dependencies:

```sh
git clone <repo-url>
cd imp
npm install
```

Useful development commands:

```sh
npm run build                    # compile TypeScript to dist/
npm run check                    # run typecheck and ESLint
npm test                         # run Vitest tests
npm run clean                    # remove dist/
just install                     # package and install only Imp globally
just install --plugins           # also install and activate all plugin packages
just install --plugin imp-voice  # also install and activate one plugin package
```

After building, run the local CLI with:

```sh
node dist/main.js --help
```

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Configuration](./docs/configuration.md)
- [Providers](./docs/providers.md)
- [Agent Context](./docs/agent-context.md)
- [Agent Tools](./docs/agent-tools.md)
- [Telegram](./docs/telegram.md)
- [Plugins](./docs/plugins.md)
- [Backups](./docs/backups.md)
- [Troubleshooting](./docs/troubleshooting.md)

## License

Imp is licensed under the [Apache License 2.0](./LICENSE).

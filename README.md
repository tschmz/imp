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

This creates a starter config you can adapt for your local setup. You can also inspect
[`config.example.json`](./config.example.json) for a more complete example.

### Start the daemon

```bash
imp
```

Or with an explicit config path:

```bash
imp --config /path/to/config.json
```

## How It Works

`imp` runs as a local daemon. It loads a JSON configuration, resolves agent and bot definitions,
initializes transports, and keeps runtime state under a local data root.

Each bot can be routed to a default agent. Each agent can define:

- a model provider and model ID
- tool access
- a working directory and context files
- a system prompt or system prompt file
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

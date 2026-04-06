# imp

`imp` is a local daemon for running agent-based bots as persistent services.

It manages agent configuration and runtime state on disk, starts configured bots, and connects them
to transports such as Telegram.

## Features

- Run one or more named agents from a single local daemon
- Route bot messages to specific agents
- Persist runtime state and logs on disk
- Configure models and providers through `@mariozechner/pi-ai`

## Quickstart

- Node.js 20.6 or newer
- Credentials for at least one supported model provider
- A Telegram bot token

Install:

```bash
npm install -g @tschmz/imp
```

Init the `imp` daemon:

```bash
imp init
```

## CLI

Main commands:

- `imp init`
- `imp start`
- `imp log`
- `imp config get|set|validate|reload`
- `imp backup create`
- `imp restore`
- `imp service install|start|stop|restart|status|uninstall`

## Development

```bash
npm install
npm run check
npm test
npm run build
```

## Documentation

- [Documentation index](./docs/index.md)
- [Getting started](./docs/getting-started.md)
- [Configuration](./docs/configuration.md)
- [Running and service](./docs/running-and-service.md)
- [Customizing agents](./docs/customizing-agents.md)
- [Backups](./docs/backups.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [Supported providers](./docs/providers.md)
- [Telegram commands](./docs/telegram.md)
- [Built-in tools](./docs/tools.md)

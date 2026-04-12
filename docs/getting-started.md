# Getting Started

`imp` is a local daemon for running agent-based endpoints as persistent services.

This guide gets you from a fresh install to a running Telegram endpoint.

Use it for the first setup. For day-to-day operation, see [Running And Service](./running-and-service.md).

## Requirements

- Node.js 20.6 or newer
- Credentials for at least one supported model provider
- A Telegram endpoint token

## Install

Install the CLI globally:

```bash
npm install -g @tschmz/imp
```

Check that the command is available:

```bash
imp --version
```

## Create Your First Config

Run the interactive setup:

```bash
imp init
```

Or write a default starter config without prompts:

```bash
imp init --defaults
```

By default, `imp` writes:

- config: `~/.config/imp/config.json`
- runtime state: `~/.local/state/imp`

If `XDG_CONFIG_HOME` or `XDG_STATE_HOME` is set, those locations are used instead.

The generated setup includes:

- one default agent
- one Telegram endpoint
- the built-in default system prompt from the installed `imp` code
- the default built-in tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`)
- `logging.level: "info"`
- `inference.metadata.app: "imp"`
- `inference.request.store: true`

If the selected provider supports OAuth, `imp init` also configures an `authFile` path under the data directory.

`imp init` does not create a `SYSTEM.md` file. To replace the built-in default prompt later, configure `agents[].prompt.base.file` or `agents[].prompt.base.text`.

Runtime data under the state directory uses this layout:

- endpoint conversations: `endpoints/<endpoint-id>/conversations`
- endpoint logs: `logs/endpoints/<endpoint-id>.log`
- endpoint runtime state: `runtime/endpoints/<endpoint-id>.json`
- agent-managed files, when you keep them in the data root: `agents/<agent-id>/...`

## Start The Daemon

Start with the discovered config:

```bash
imp start
```

Or with an explicit config path:

```bash
imp start --config /path/to/config.json
```

## Validate And Inspect

Validate the active config:

```bash
imp config validate
```

Inspect a config value:

```bash
imp config get defaults.agentId
```

## Read Logs

Show recent log lines:

```bash
imp log
```

Follow the log stream:

```bash
imp log --follow
```

## Next Steps

- Read [Configuration](./configuration.md) to understand the config structure and config discovery order.
- Read [Running And Service](./running-and-service.md) to keep `imp` running in the background and handle service credentials correctly.
- Read [Telegram Commands](./telegram.md) to see the built-in endpoint command surface.
- Read [Customizing Agents](./customizing-agents.md) to tailor prompts, tools, and workspaces.

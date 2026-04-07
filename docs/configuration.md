# Configuration

`imp` is configured with a single JSON file.

The top-level structure is:

- `instance`: metadata for this installation
- `paths`: runtime storage locations
- `logging`: daemon log level
- `defaults`: fallback routing
- `agents`: one or more agent definitions
- `bots`: one or more bot definitions

## Minimal Shape

```json
{
  "instance": {
    "name": "home"
  },
  "paths": {
    "dataRoot": "/home/me/.local/state/imp"
  },
  "defaults": {
    "agentId": "default"
  },
  "agents": [
    {
      "id": "default",
      "model": {
        "provider": "openai",
        "modelId": "gpt-5.4"
      },
      "prompt": {
        "base": {
          "file": "/home/me/.local/state/imp/SYSTEM.md"
        }
      }
    }
  ],
  "bots": [
    {
      "id": "private-telegram",
      "type": "telegram",
      "enabled": true,
      "token": "replace-me",
      "access": {
        "allowedUserIds": ["123456789"]
      }
    }
  ]
}
```

## Config Discovery

`imp` resolves the config file in this order:

1. `--config /path/to/config.json`
2. `IMP_CONFIG_PATH`
3. `XDG_CONFIG_HOME/imp/config.json`
4. `~/.config/imp/config.json`
5. `/etc/imp/config.json`

For operations, prefer passing `--config` explicitly when you want to avoid ambiguity.

## Agents

An agent defines how `imp` answers messages.

Common fields:

- `id`: unique identifier
- `name`: optional display name
- `model.provider`: provider ID
- `model.modelId`: model name or ID
- `prompt.base`: required system prompt, as `text` or `file`
- `prompt.instructions`: optional extra instruction files or inline text
- `prompt.references`: optional context files or inline text
- `authFile`: optional OAuth credential file for providers that support it
- `tools`: tools the agent may use
- `workspace.cwd`: working directory for file and shell tools
- `workspace.shellPath`: extra PATH entries for the `bash` tool
- `inference`: provider-specific request settings

Important rules:

- each agent ID must be unique
- `defaults.agentId` must point to an existing agent
- prompt sources must specify exactly one of `text` or `file`
- `authFile` only works with OAuth-capable providers

## Bots

Bots expose agents through transports.

Today, `telegram` is the only supported bot type.

Common Telegram fields:

- `id`: unique bot ID
- `enabled`: whether the bot starts
- `token`: Telegram bot token
- `access.allowedUserIds`: list of allowed Telegram user IDs
- `routing.defaultAgentId`: optional per-bot agent override

Only enabled bots are started. At least one bot must be enabled.

## Relative Paths

If a config file contains relative paths, `imp` resolves them relative to the config file directory.

This applies to:

- prompt files
- instruction files
- reference files
- `authFile`
- `workspace.cwd`

## Service Environment

Provider credentials and other service-only environment variables are not stored in `config.json`.

When `imp` runs interactively, it uses the current process environment.
When `imp` runs as a service, environment handling depends on the platform:

- Linux systemd user services use a `service.env` file next to the config file. `imp init` can prompt for these values during interactive setup.
- macOS launchd agents do not use `service.env`; make required environment variables available to the launchd job itself.

If you change service credentials on Linux, re-run:

```bash
imp service install --force
```

## Operator Checklist

When inspecting a live installation, verify at least:

- which bots are `enabled`
- each bot's `routing.defaultAgentId`
- each agent's `model.provider` and `model.modelId`
- each agent's `authFile`, if used
- each agent's `prompt.base`, `prompt.instructions`, and `prompt.references`
- each agent's `workspace.cwd` and `workspace.shellPath`, if used
- whether required provider credentials are present in the interactive environment or, for Linux services, in `service.env`

## Updating Config Values

Read a value:

```bash
imp config get bots.0.enabled
```

Set a value:

```bash
imp config set logging.level '"debug"'
```

Set arrays or objects with JSON:

```bash
imp config set bots.0.access.allowedUserIds '["123456789"]'
```

Validate after changes:

```bash
imp config validate
```

## Example Config

See [`config.example.json`](../config.example.json) for a fuller multi-agent example.

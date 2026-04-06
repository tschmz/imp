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

Unless you pass `--config`, `imp` searches for a config in this order:

1. `IMP_CONFIG_PATH`
2. `XDG_CONFIG_HOME/imp/config.json`
3. `~/.config/imp/config.json`
4. `/etc/imp/config.json`

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

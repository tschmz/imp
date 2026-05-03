# Configuration

Imp uses one JSON config file per installation. For normal use, prefer `imp config` commands over editing the file by hand: the CLI targets the active config, validates updates, and lets you address agents and endpoints by ID.

## Find the Active Config

Imp resolves the config file in this order:

1. `--config /path/to/config.json`
2. `IMP_CONFIG_PATH`
3. `XDG_CONFIG_HOME/imp/config.json`, when `XDG_CONFIG_HOME` is set
4. `~/.config/imp/config.json`, when `XDG_CONFIG_HOME` is not set
5. `/etc/imp/config.json`

Use `--config` when a command should target a specific installation:

```sh
imp config validate --config /path/to/config.json
```

## Inspect Values

Read a value:

```sh
imp config get defaults.agentId
imp config get logging.level
```

Agents and endpoints can be addressed by ID:

```sh
imp config get agents.default.model
imp config get endpoints.private-telegram.enabled
```

Use `*` to list values from multiple entries:

```sh
imp config get agents.*.id
imp config get endpoints.*.enabled
```

## Update Values

Set simple values directly:

```sh
imp config set logging.level debug
imp config set defaults.model.provider openai
imp config set defaults.model.modelId gpt-5.5
```

Set arrays or objects as JSON:

```sh
imp config set endpoints.private-telegram.access.allowedUserIds '["123456789"]'
imp config set agents.default.prompt.instructions '[{"file":"./agents/default/AGENTS.md"}]'
```

Validate after changes:

```sh
imp config validate
```

Run a deeper check before starting the daemon or a chat:

```sh
imp config validate --preflight
```

`--preflight` also resolves runtime agent config, tools, prompt files, instruction files, reference files, and explicit secret-file references.

## Main Config Areas

| Area | What it controls |
| --- | --- |
| `instance` | Human-readable installation metadata |
| `paths` | Runtime storage locations |
| `logging` | Daemon log level |
| `defaults` | Default agent and shared model config |
| `agents` | Agent prompts, models, workspaces, skills, and tools |
| `tools` | Shared integrations such as MCP servers |
| `plugins` | Installed plugin packages |
| `endpoints` | Telegram, file, and named CLI endpoints |

See [`config.example.json`](../config.example.json) for a complete example.

## Secrets

Telegram tokens and model API keys can be stored as:

- Inline strings
- Environment variable references, such as `{"env":"IMP_TELEGRAM_BOT_TOKEN"}`
- Secret file references, such as `{"file":"./secrets/telegram.token"}`

Prefer environment variables or secret files over inline secrets:

```sh
imp config set endpoints.private-telegram.token '{"env":"IMP_TELEGRAM_BOT_TOKEN"}'
imp config set defaults.model.apiKey '{"env":"OPENAI_API_KEY"}'
```

Secret file paths are resolved relative to the config file directory unless they are absolute.

## Relative Paths

Relative paths in the config are resolved from the config file directory, not from the shell directory where you run `imp`.

This applies to prompt files, instruction files, reference files, auth files, secret files, workspaces, and plugin package paths.

Use absolute paths when the same config is managed from different working directories.

## Service Environment

When Imp runs interactively, it uses your current shell environment. When Imp runs as a service, provider credentials and token variables must be available to the service process.

After changing service environment values, reinstall or refresh the service definition if needed:

```sh
imp service install --force
```

Then restart or reload the service according to your platform.

## Apply Config Changes

After changing config values, reload the installed service:

```sh
imp config reload
```

If needed, restart the service directly:

```sh
imp service restart
```

From Telegram, `/reload` asks the daemon to exit after replying so a supervisor can start it again with fresh config. `/restart` uses the same supervisor restart path.

Prompt, reference, and skill file edits are picked up on the next user turn when the config already points to those files.

## Validation Checklist

When validation fails, check:

- Agent IDs are unique
- Endpoint IDs are unique
- `defaults.agentId` points to an existing agent
- Endpoint routing points to an existing agent
- Prompt sources use exactly one of `text`, `file`, or `builtIn`
- Telegram token secret references resolve
- With `--preflight`: prompt, instruction, reference, and auth files are readable
- With `--preflight`: built-in tool names, MCP servers, and delegated agents resolve

Provider credentials that are only read by a provider SDK may not be checked until the agent runs. If validation passes but a run fails, check the runtime or service environment.

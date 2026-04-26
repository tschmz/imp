# Configuration

Imp is configured with one JSON file, but day-to-day changes should usually go through the config CLI. The CLI updates the active config, validates the result, and lets you address agents and endpoints by ID.

## Find the Active Config

Imp resolves the config file in this order:

1. `--config /path/to/config.json`
2. `IMP_CONFIG_PATH`
3. `XDG_CONFIG_HOME/imp/config.json`, when `XDG_CONFIG_HOME` is set
4. `~/.config/imp/config.json`, when `XDG_CONFIG_HOME` is not set
5. `/etc/imp/config.json`

Pass `--config` when you want a command to target a specific installation:

```sh
imp config validate --config /path/to/config.json
```

## Inspect Values

Read a config value:

```sh
imp config get defaults.agentId
```

`config get` prints the effective value. When a supported setting is not explicitly configured, it returns the value Imp would use at runtime:

```sh
imp config get logging.level
imp config get agents.default.home
```

Agents and endpoints can be addressed by ID:

```sh
imp config get agents.default.model
imp config get endpoints.private-telegram.enabled
```

Use `*` to select multiple values from arrays or objects. Wildcard results are printed as JSON arrays:

```sh
imp config get agents.*.id
imp config get endpoints.*.enabled
```

## Update Values

Set simple values directly:

```sh
imp config set logging.level debug
imp config set agents.default.model.provider openai
imp config set agents.default.model.modelId gpt-5.4
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

Print the JSON Schema for config-shape reference:

```sh
imp config schema
```

The schema describes field structure and basic value constraints. Use `imp config validate` for cross-reference checks, duplicate-id rules, and secret-reference validation.

Use [Agent Context](./agent-context.md), [Agent Tools](./agent-tools.md), and [Providers](./providers.md) for the most common agent-specific settings.

## Main Config Areas

The top-level config is organized around these areas:

- `instance`: installation metadata
- `paths`: runtime storage locations
- `logging`: daemon log level
- `defaults`: fallback agent routing
- `agents`: agent definitions
- `tools`: reusable tool integrations such as MCP servers
- `plugins`: installed local plugin definitions
- `endpoints`: Telegram, file, and named CLI endpoints

`imp chat` always has a local CLI endpoint available. Non-CLI endpoints are started by `imp start` or by the installed service.

## Secrets

Telegram endpoint tokens can be stored in three forms:

- Inline string
- Environment variable reference, such as `{"env":"IMP_TELEGRAM_BOT_TOKEN"}`
- Secret file reference, such as `{"file":"./secrets/telegram.token"}`

Prefer environment variables or secret files over inline tokens:

```sh
imp config set endpoints.private-telegram.token '{"env":"IMP_TELEGRAM_BOT_TOKEN"}'
```

Secret file paths are resolved relative to the config file directory unless they are absolute.

## Relative Paths

Relative paths in the config are resolved from the config file directory, not from the shell directory where you run `imp`.

This applies to:

- Prompt files
- Instruction files
- Reference files
- `authFile`
- Secret files
- `workspace.cwd`
- Plugin package paths

Use absolute paths when the same config is managed from different working directories.

## Service Environment

When Imp runs interactively, it uses the current shell environment. When Imp runs as a service, provider credentials and other environment variables must be available to the service process.

On Linux, reinstall the managed service after changing service environment values:

```sh
imp service install --force
```

On macOS, make the required variables available to the launchd job.

## Apply Config Changes

Changes to config values require the affected endpoint to reload or restart:

```sh
imp config reload
```

If Imp is running under a service manager, `/reload` or `/restart` from Telegram can also trigger the daemon to exit so the supervisor starts it again.

Edits to prompt, reference, and skill files are picked up on the next user turn, as long as the config already points to those files.

## Validation Checklist

When config validation fails, check these first:

- Agent IDs are unique
- Endpoint IDs are unique
- `defaults.agentId` points to an existing agent
- Endpoint routing points to an existing agent
- Prompt sources use exactly one of `text` or `file`
- Telegram token secret references resolve

Provider credentials are used when the agent runs, not during `imp config validate`. If validation passes but a run fails, check the runtime or service environment for the variables required by the configured provider.

See [`config.example.json`](../config.example.json) for a complete example config.

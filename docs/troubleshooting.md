# Troubleshooting

Start with the failing command and the active config. Most setup problems are caused by targeting a different config file than expected, missing credentials, or a service environment that differs from the interactive shell.

## `imp start` Cannot Find a Config

Check where Imp looks for config:

1. `--config /path/to/config.json`
2. `IMP_CONFIG_PATH`
3. `XDG_CONFIG_HOME/imp/config.json`, when `XDG_CONFIG_HOME` is set
4. `~/.config/imp/config.json`, when `XDG_CONFIG_HOME` is not set
5. `/etc/imp/config.json`

Create a fresh config when needed:

```sh
imp init
```

Use `--config` when you want to remove ambiguity:

```sh
imp start --config /path/to/config.json
```

## Config Validation Fails

Validate explicitly:

```sh
imp config validate
```

Common causes are:

- Duplicate agent IDs
- Duplicate endpoint IDs
- `defaults.agentId` points to a missing agent
- An endpoint routes to a missing agent
- A prompt source defines both `text` and `file`
- A Telegram token environment variable is missing
- A Telegram token file is missing, unreadable, or empty

If `imp start` reports `Config must enable at least one daemon endpoint.`, enable a non-CLI endpoint such as Telegram, or use `imp chat` for a local CLI chat.

## Telegram Does Not Respond

Check these first:

- The endpoint is enabled
- The bot token is valid
- Your Telegram user ID is listed in `access.allowedUserIds`
- You are messaging the bot in a private chat
- The daemon or service is running

Once the endpoint is reachable, use `/whoami` to confirm the user and chat IDs.

## Service Differs From the Shell

This usually means the service environment is missing provider credentials, token variables, OAuth files, or PATH entries.

Check the variables required by the configured provider and any endpoint token references. On Linux, refresh the managed service environment:

```sh
imp service install --force
```

Then restart the service.

## Prompt Files Are Not Found

Relative paths are resolved from the config file directory, not from the current shell directory.

Check these fields:

- `prompt.base.file`
- `prompt.instructions[].file`
- `prompt.references[].file`
- `authFile`
- `workspace.cwd`
- `endpoints[].token.file`

Use absolute paths if the config is edited or executed from different directories.

## Prompt Templating Fails

Prompt text and prompt files can use template variables. Templating fails when the prompt references an unknown variable or unsupported helper.

Check:

- The file path named in the error
- The exact variable name
- Whether the value exists in the current runtime context
- Whether the helper is one of the built-in helpers documented in [Agent Context](./agent-context.md)

Known variables with no runtime value render as an empty string. Unknown variables fail during prompt assembly.

## Tools Are Missing

Tools must be enabled for the active agent. Check the selected agent first:

```sh
imp config get agents.default.tools
```

For Telegram chats, `/agent` shows the selected agent and its configured tools.

See [Agent Tools](./agent-tools.md) for built-in tools, MCP servers, delegated agents, and skills.

## Need More Detail

- [Configuration](./configuration.md)
- [Telegram](./telegram.md)
- [Providers](./providers.md)
- [Agent Context](./agent-context.md)
- [Agent Tools](./agent-tools.md)

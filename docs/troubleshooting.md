# Troubleshooting

Start with the failing command and the active config. Most setup problems are caused by targeting a different config file than expected, missing credentials, or a service environment that differs from your shell.

## Find the Config Imp Is Using

Imp looks for config in this order:

1. `--config /path/to/config.json`
2. `IMP_CONFIG_PATH`
3. `XDG_CONFIG_HOME/imp/config.json`
4. `~/.config/imp/config.json`
5. `/etc/imp/config.json`

Validate explicitly:

```sh
imp config validate --preflight
```

Use `--config` when you want to remove ambiguity:

```sh
imp start --config /path/to/config.json
```

## Config Validation Fails

Common causes:

- Duplicate agent IDs
- Duplicate endpoint IDs
- `defaults.agentId` points to a missing agent
- An endpoint routes to a missing agent
- A prompt source defines both `text` and `file`
- A Telegram token environment variable is missing
- A token, prompt, reference, or auth file is missing or unreadable
- A configured tool name, MCP server, or delegated agent does not exist

If `imp start` reports `Config must enable at least one daemon endpoint.`, enable a non-CLI endpoint such as Telegram, or use `imp chat` for a local terminal chat.

## Telegram Does Not Respond

Check:

- The endpoint is enabled
- The bot token is valid
- Your Telegram user ID is in `access.allowedUserIds`
- You are messaging the bot in a private chat
- The daemon or service is running

Once reachable, use `/whoami` to confirm user and chat IDs.

## Service Differs From the Shell

The service may be missing provider credentials, token variables, OAuth files, or PATH entries.

Check the variables required by your provider and endpoint token references. Then refresh and restart the service if needed:

```sh
imp service install --force
imp service restart
```

## Prompt or Auth Files Are Not Found

Relative paths are resolved from the config file directory, not from the directory where you run `imp`.

Check these fields:

- `prompt.base.file`
- `prompt.instructions[].file`
- `prompt.references[].file`
- `defaults.model.authFile`
- `agents[].model.authFile`
- `workspace.cwd`
- `endpoints[].token.file`

Use absolute paths if the config is edited or executed from different directories.

## Prompt Templating Fails

Prompt text and prompt files can use template variables. Templating fails when a prompt references an unknown variable or unsupported helper.

Check:

- The file path named in the error
- The exact variable name
- Whether the value exists in the current runtime context
- Whether the helper is documented in [Agent Context](./agent-context.md)

Known variables with no runtime value render as empty strings. Unknown variables fail during prompt assembly.

## Tools Are Missing

Tools must be enabled for the selected agent.

```sh
imp config get agents.default.tools
```

For Telegram chats, `/agent` shows the selected agent and configured tools.

See [Agent Tools](./agent-tools.md).

## Need More Detail

- [Configuration](./configuration.md)
- [Providers](./providers.md)
- [Telegram](./telegram.md)
- [Agent Context](./agent-context.md)
- [Agent Tools](./agent-tools.md)
- [Plugins](./plugins.md)
- [Backups](./backups.md)

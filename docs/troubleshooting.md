# Troubleshooting

## `imp start` Cannot Find A Config

Check where `imp` looks for the config:

- `--config /path/to/config.json`
- `IMP_CONFIG_PATH`
- `XDG_CONFIG_HOME/imp/config.json`
- `~/.config/imp/config.json`
- `/etc/imp/config.json`

If needed, create a fresh config:

```bash
imp init
```

## Config Validation Fails

Validate explicitly:

```bash
imp config validate
```

Common causes:

- duplicate agent IDs
- duplicate bot IDs
- `defaults.agentId` points to a missing agent
- a bot routes to a missing agent
- a prompt source defines both `text` and `file`
- all bots are disabled

## Telegram Bot Does Not Respond

Check these first:

- the bot token is valid
- the bot is enabled
- your Telegram user ID is listed in `access.allowedUserIds`
- you are messaging the bot in a private chat

Use `/whoami` to inspect the current Telegram user and chat IDs once the bot is reachable.

## Service Starts Differently From The Shell

This usually means the service environment is missing provider credentials or PATH entries.

Check:

- API key variables required by the chosen provider
- OAuth credential files such as `authFile`
- service-specific environment files

On Linux, refresh the managed service environment:

```bash
imp service install --force
```

## Prompt Or Reference Files Are Not Found

Remember that relative paths are resolved relative to the config file directory, not the current shell directory.

If in doubt, switch to absolute paths for:

- `prompt.base.file`
- `prompt.instructions[].file`
- `prompt.references[].file`
- `authFile`
- `workspace.cwd`

## Need More Detail

- See [Telegram commands](./telegram.md)
- See [Supported providers](./providers.md)
- See [Built-in tools](./tools.md)

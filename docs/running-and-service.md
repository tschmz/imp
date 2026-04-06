# Running And Service

`imp` can run in the foreground for development or as a background service for daily use.

## Run In The Foreground

Start the daemon:

```bash
imp start
```

Use a specific config file:

```bash
imp start --config /path/to/config.json
```

This mode is useful while setting up the config, testing prompts, or watching logs locally.

## View Logs

Show recent logs:

```bash
imp log
```

Show logs for one bot:

```bash
imp log --bot private-telegram
```

Follow new log lines:

```bash
imp log --follow
```

## Install As A Background Service

Install the service definition:

```bash
imp service install
```

Preview the generated service without installing it:

```bash
imp service install --dry-run
```

Overwrite an existing service definition:

```bash
imp service install --force
```

Supported service targets:

- Linux: systemd user service
- macOS: launchd agent

Windows note:

- Windows can render a WinSW-style service definition with `imp service install --dry-run`, but automatic install, uninstall, start, stop, restart, and status operations are not implemented yet.

## Manage The Service

Start:

```bash
imp service start
```

Stop:

```bash
imp service stop
```

Restart:

```bash
imp service restart
```

Show status:

```bash
imp service status
```

Remove the installed service:

```bash
imp service uninstall
```

## Reloading Config

To tell an installed service to reload config from disk:

```bash
imp config reload
```

This is intended for the installed background service. If you are running `imp start` directly in a shell, stop and start it again after changing the config.

## Service Environment

When `imp` runs as a service, it may not inherit the same shell environment you use interactively.

This matters for provider credentials such as:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`

On Linux, `imp service install` manages a service environment file named `service.env` next to the config file. Re-run this command after environment changes:

```bash
imp service install --force
```

## Operational Model

At runtime, `imp`:

- loads the config
- starts all enabled bots
- routes each incoming conversation to an agent
- persists conversation state and logs under `paths.dataRoot`

If a bot is disabled in the config, it is skipped on startup.

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

It is also the simplest way to verify behavior before installing a background service.

## Chat In The Terminal

Start the local CLI chat endpoint:

```bash
imp chat
```

Use a named CLI chat profile from the config:

```bash
imp chat --endpoint local-cli
```

`imp chat` always starts a local CLI endpoint in the foreground. If no CLI profile is configured, it uses `local-cli`. Chat uses `defaults.agentId` as the default agent and does not start Telegram endpoints.

## View Logs

Show recent logs:

```bash
imp log
```

Show logs for one endpoint:

```bash
imp log --endpoint private-telegram
```

Agent-specific runtime details, such as skill discovery and agent-engine pipeline events, are written to `logs/agents/<agent-id>.log`.

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

Platform behavior differs:

- Linux systemd user services use a `service.env` file next to the config file.
- macOS launchd agents do not use `service.env`; the generated plist only defines program arguments, working directory, restart behavior, and load policy. Required environment variables must be available to the launchd job itself.

On Linux, `imp service install` creates or updates `service.env`. Re-run this command after environment changes:

```bash
imp service install --force
```

`service.env` is operational state for the installed Linux service. It is not part of `config.json`.

If foreground execution works but the installed Linux service does not, compare the interactive shell environment with `service.env` before assuming a product bug.

## Operational Model

At runtime, `imp`:

- loads the config
- starts all enabled endpoints
- routes each incoming conversation to an agent
- persists conversation state, logs, and runtime state under `paths.dataRoot`

If an endpoint is disabled in the config, it is skipped on startup.

For command-level endpoint behavior, see [Telegram Commands](./telegram.md).

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
      "token": {
        "env": "IMP_TELEGRAM_BOT_TOKEN"
      },
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
- `skills.paths`: optional shared skill directories for this agent
- `inference`: provider-specific request settings

Important rules:

- each agent ID must be unique
- `defaults.agentId` must point to an existing agent
- prompt sources must specify exactly one of `text` or `file`
- `authFile` only works with OAuth-capable providers

## Secret References

V1 secret references are currently supported for Telegram bot tokens via `bots[].token`.

That field can be written in one of three forms:

- inline string: `"token": "123456:abc"`
- environment variable reference: `"token": { "env": "IMP_TELEGRAM_BOT_TOKEN" }`
- secret file reference: `"token": { "file": "./secrets/telegram.token" }`

Rules:

- string values keep the existing behavior for current configs
- secret references must specify exactly one of `env` or `file`
- `env` names must look like normal environment variable names
- `file` values may be absolute or relative to the config file directory
- secret files are read as UTF-8; a single trailing newline is ignored so common `echo`-written files work
- `imp config validate` checks that configured Telegram token references can be resolved from the current environment and filesystem

Operational guidance:

- prefer env or file references over inline tokens in `config.json`
- keep secret files and the config directory readable only by the `imp` user, for example with `chmod 600` on files and `chmod 700` on the directory
- avoid copying secret files into unrelated sync folders, support bundles, or broad filesystem backups unless that is intentional

### Prompt File Templating V1

`imp` can render a small set of template variables in prompt files, but only for file-backed entries in:

- `prompt.instructions[].file`
- `prompt.references[].file`

Not templated:

- `prompt.base`
- inline `text` prompt sources

Syntax is strictly `{{path.to.value}}`.

Constraints:

- unknown variables fail hard during prompt assembly
- documented variables with no runtime value render as an empty string
- only simple variable paths are supported
- no functions, loops, conditionals, defaults, or date/time variables
- expressions with extra syntax such as whitespace inside the braces fail as unsupported template syntax
- the context is curated and stable so prompt caching stays deterministic

Available variables:

- `system.os`
- `system.platform`
- `system.arch`
- `system.hostname`
- `system.username`
- `system.homeDir`
- `bot.id`
- `agent.id`
- `agent.model.provider`
- `agent.model.modelId`
- `agent.authFile`
- `agent.workspace.cwd`
- `transport.kind`
- `imp.configPath`
- `imp.dataRoot`

## Bots

Bots expose agents through transports.

Today, `telegram` is the only supported bot type.

Common Telegram fields:

- `id`: unique bot ID
- `enabled`: whether the bot starts
- `token`: Telegram bot token
- `token.env`: read the token from an environment variable
- `token.file`: read the token from a secret file
- `access.allowedUserIds`: list of allowed Telegram user IDs
- `voice.enabled`: whether Telegram voice messages are accepted for this bot
- `voice.transcription.provider`: STT backend, currently only `openai`
- `voice.transcription.model`: OpenAI transcription model, for example `gpt-4o-mini-transcribe`
- `voice.transcription.language`: optional ISO-639-1 language hint such as `en`
- `routing.defaultAgentId`: optional per-bot agent override

Only enabled bots are started. At least one bot must be enabled.

Skill discovery and activation notes:

- each `agents[].skills.paths` entry is resolved relative to the config file when needed
- `imp` scans only direct subdirectories of each configured path for `SKILL.md`
- if the active agent has an explicit working directory (`conversation.state.workingDirectory` or `agent.workspace.cwd`), `imp` also scans `<working-directory>/.skills` on each user turn
- automatic `.skills` loading does not fall back to the daemon process working directory
- workspace `.skills` are discovered fresh on each turn, so edits take effect without a daemon restart
- `SKILL.md` must have valid YAML frontmatter with at least `name` and `description`
- invalid configured skills are ignored and logged during startup, and discovered configured skill names are logged per agent
- invalid workspace skills are ignored and logged on the affected turn
- duplicate skill names across configured `agents[].skills.paths` are rejected and all colliding configured entries are ignored
- when a workspace `.skills` entry has the same name as a configured agent skill, the workspace skill overrides the configured one for that turn
- available skills are always injected into prompt context as metadata only: skill directory path, skill name, and skill description
- per user turn, `imp` asks the configured agent model to select at most three skills using only skill `name` and `description`
- if selection fails, `imp` still exposes the available skill metadata in prompt context but activates no skills
- activated `SKILL.md` files are injected into prompt context as read-only content
- when a skill contains `references/`, those files are loaded into prompt context when the skill is activated
- when a skill contains `scripts/`, those script paths are exposed to the agent as explicit local resources; they are never executed automatically
- activated skill names are logged per turn for diagnostics

Voice transcription notes:

- V1 only accepts Telegram `voice` messages, not arbitrary audio uploads.
- When enabled, voice messages are transcribed into plain text before they reach the application layer.
- The transcript is shown in Telegram before the agent reply, but sessions remain text-centric and store the transcript text rather than the original audio.
- OpenAI transcription requires `OPENAI_API_KEY` in the runtime environment or service environment.

## Relative Paths

If a config file contains relative paths, `imp` resolves them relative to the config file directory.

This applies to:

- prompt files
- instruction files
- reference files
- `authFile`
- secret reference files such as `bots[].token.file`
- `workspace.cwd`

## Service Environment

Provider credentials and other service-only environment variables are not stored in `config.json`.
Telegram bot tokens may stay inline for compatibility, but environment-variable or secret-file references are the preferred operational pattern.

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
- whether each bot token resolves from its inline value, environment variable, or secret file as intended

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

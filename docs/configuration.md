# Configuration

`imp` is configured with a single JSON file.

The top-level structure is:

- `instance`: metadata for this installation
- `paths`: runtime storage locations
- `logging`: daemon log level
- `defaults`: fallback routing
- `agents`: one or more agent definitions
- `plugins`: optional external local component definitions
- `endpoints`: zero or more endpoint definitions

## Minimal Shape

The local CLI chat endpoint is always available through `imp chat`, so a starter config can omit explicit endpoints:

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
      }
    }
  ],
  "endpoints": []
}
```

Add a non-CLI endpoint before running `imp start` or installing the service:

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
      }
    }
  ],
  "endpoints": [
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
- `model.api`: optional API type for custom models, for example `openai-responses`
- `model.baseUrl`: optional base URL override for built-in models or required base URL for custom models
- `model.reasoning`, `model.input`, `model.contextWindow`, `model.maxTokens`: optional overrides for built-in models and required fields for fully custom models
- `model.headers`: optional request headers for built-in or custom models
- `prompt.base`: optional system prompt override, as `text` or `file`; when omitted, `imp` uses the built-in default prompt from the installed code
- `prompt.instructions`: optional extra instruction files or inline text
- `prompt.references`: optional context files or inline text
- `home`: optional agent home directory; defaults to `paths.dataRoot/agents/<agent-id>`
- `authFile`: optional OAuth credential file for providers that support it
- `tools`: tools the agent may use
- `tools.builtIn`: built-in tools the agent may use
- `tools.mcp.servers`: global MCP server IDs the agent may use
- `tools.phone`: allowlisted phone call tool configuration
- `tools.agents`: explicit delegated agent tools exposed as allowlisted one-tool-per-agent calls
- `workspace.cwd`: working directory for file and shell tools
- `workspace.shellPath`: extra PATH entries for the `bash` tool
- `skills.paths`: optional shared skill directories for this agent
- `inference`: provider-specific request settings

Important rules:

- each agent ID must be unique
- `defaults.agentId` must point to an existing agent
- prompt sources must specify exactly one of `text` or `file`
- `authFile` only works with OAuth-capable providers
- `tools.agents[].agentId` must point to another configured agent and cannot reference the current agent
- custom models must provide `model.api`, `model.baseUrl`, `model.reasoning`, `model.input`, `model.contextWindow`, and `model.maxTokens`

## Tools

Top-level `tools` defines reusable tool integrations. Agents opt into those integrations explicitly.

MCP server fields:

- `tools.mcp.servers[].id`: unique MCP server identifier
- `tools.mcp.servers[].command`: command used to start the stdio MCP server
- `tools.mcp.servers[].args`: optional command arguments
- `tools.mcp.inheritEnv`: optional environment variable allowlist inherited by all MCP servers from the `imp` process environment
- `tools.mcp.servers[].inheritEnv`: optional server-specific environment variable allowlist inherited from the `imp` process environment
- `tools.mcp.servers[].env`: optional environment variables
- `tools.mcp.servers[].cwd`: optional working directory, resolved relative to the config file

Agents reference global MCP servers by ID:

```json
{
  "tools": {
    "mcp": {
      "inheritEnv": ["GITHUB_TOKEN"],
      "servers": [
        {
          "id": "github",
          "command": "github-mcp-server",
          "args": ["stdio"]
        }
      ]
    }
  },
  "agents": [
    {
      "id": "default",
      "tools": {
        "builtIn": ["read", "bash"],
        "mcp": {
          "servers": ["github"]
        }
      }
    }
  ]
}
```

Agents can also expose other configured agents as explicit tools:

```json
{
  "agents": [
    {
      "id": "default",
      "tools": {
        "builtIn": ["read", "bash"],
        "agents": [
          {
            "agentId": "ops"
          },
          {
            "agentId": "writer",
            "toolName": "draft_copy",
            "description": "Ask the writer agent for draft copy."
          }
        ]
      }
    }
  ]
}
```

Behavior:

- each `tools.agents[]` entry creates one tool for the parent agent
- omitted `toolName` defaults to `ask_<agent-id>` with invalid characters normalized to `_`
- delegated runs are ephemeral: they do not persist child conversation state and do not change the child's selected session
- delegated agents run with their own prompt, model, tools, and workspace
- delegated tools accept only `{ "input": "<string>" }`
- delegation nesting is limited to one level; a delegated child cannot delegate again

## Data Root Layout

`paths.dataRoot` stores local runtime and agent support files. The conventional layout is:

```text
dataRoot/
  auth.json
  agents/
    <agent-id>/
      AGENTS.md
      SOUL.md
      workspace/
  conversations/
    agents/
      <agent-id>/
        active.json
        sessions/
    chats/
      <transport>/
        <chat-id>/
          selected-agent.json
  logs/
    endpoints/
      <endpoint-id>.log
    agents/
      <agent-id>.log
  runtime/
    endpoints/
      <endpoint-id>.json
    plugins/
      <plugin-id>/
        endpoints/
          <endpoint-id>/
            inbox/
            processing/
            processed/
            failed/
            outbox/
  skills/
```

The shared `conversations/` tree stores one active session pointer per agent plus each chat's currently selected agent. Endpoint logs live under `logs/endpoints`, agent-scoped logs live under `logs/agents`, and runtime lock/state files live under the central `runtime/endpoints` tree. File endpoint ingress and egress for plugins live under `runtime/plugins/<plugin-id>/endpoints/<endpoint-id>`. Agent home directories default to `agents/<agent-id>`, and every direct `*.md` file in an agent home is loaded alphabetically as an instruction block before explicit `prompt.instructions` and the workspace `AGENTS.md`.

## Secret References

Secret references are supported for Telegram endpoint tokens via `endpoints[].token`.

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

### Prompt File Templating

`imp` renders Handlebars templates for file-backed prompt entries in:

- `prompt.base.file`
- `prompt.instructions[].file`
- `prompt.references[].file`

Not templated:

- inline `text` prompt sources

Supported syntax includes normal variable paths such as `{{endpoint.id}}`, conditionals such as `{{#if skills.length}}...{{else}}...{{/if}}`, equality checks such as `{{#if (eq reply.channel.kind "audio")}}...{{/if}}`, and loops such as `{{#each skills}}...{{/each}}`.

Constraints:

- unknown variables fail hard during prompt assembly
- documented variables with no runtime value render as an empty string
- only the built-in `if`, `unless`, `each`, `with`, `eq`, `instructionAttr`, and `instructionText` helpers are available by default
- `instructionAttr` escapes values for XML-like instruction tag attributes
- `instructionText` escapes values for XML-like instruction tag text
- arbitrary JavaScript execution and custom user-defined helpers are not supported
- second-precision runtime clock values such as `runtime.now.iso`, `runtime.now.time`, and `runtime.now.local` are not cached
- minute-precision values such as `runtime.now.timeMinute` and `runtime.now.localMinute` are cached per minute

Available variables:

- `system.os`
- `system.platform`
- `system.arch`
- `system.hostname`
- `system.username`
- `system.homeDir`
- `runtime.now.iso`
- `runtime.now.date`
- `runtime.now.time`
- `runtime.now.timeMinute`
- `runtime.now.local`
- `runtime.now.localMinute`
- `runtime.timezone`
- `endpoint.id`
- `agent.id`
- `agent.home`
- `agent.model.provider`
- `agent.model.modelId`
- `agent.authFile`
- `agent.workspace.cwd`
- `transport.kind`
- `conversation.kind`
- `conversation.metadata`
- `reply.channel.kind`
- `reply.channel.delivery`
- `reply.channel.endpointId`
- `imp.configPath`
- `imp.dataRoot`
- `skills`
- `skills[].name`
- `skills[].description`
- `skills[].directoryPath`
- `skills[].filePath`

Reply-channel context describes where the answer will go, not where the inbound message came from. Normal endpoint conversations use the current endpoint transport. File endpoint responses with `response.type: "endpoint"` use the target endpoint transport and endpoint ID. File endpoint outbox responses use the explicit `response.replyChannel.kind` value from config, and `none` responses use `reply.channel.kind` set to `none`. Channel-specific behavior belongs in prompt files, not in hidden daemon prompts.

Conversation context describes the current session. Plugins may set `conversation.kind` and `conversation.metadata` when they create a detached session. For imp-phone sessions, `conversation.kind` is `phone-call` and metadata includes `contact_id`, `contact_name`, and `contact_uri`.

Guard plugin-specific metadata with the session kind:

```hbs
{{#if (eq conversation.kind "phone-call")}}
You are currently on a phone call with {{conversation.metadata.contact_name}} at {{conversation.metadata.contact_uri}}.
{{/if}}
```

Example:

```hbs
{{#if skills.length}}
<available_skills>
{{#each skills}}
<skill>
<name>
{{instructionText name}}
</name>
<description>
{{instructionText description}}
</description>
<location>
{{instructionText filePath}}
</location>
</skill>
{{/each}}
</available_skills>
{{/if}}
```

## Endpoints

Endpoints expose agents through transports.

Supported endpoint types:

- `telegram`
- `cli`

Common endpoint fields:

- `id`: unique endpoint ID
- `enabled`: whether the endpoint starts under `imp start` or the service
- `routing.defaultAgentId`: optional per-endpoint agent override for daemon endpoints

Telegram fields:

- `token`: Telegram endpoint token
- `token.env`: read the token from an environment variable
- `token.file`: read the token from a secret file
- `access.allowedUserIds`: list of allowed Telegram user IDs
- `voice.enabled`: whether Telegram voice messages are accepted for this endpoint
- `voice.transcription.provider`: STT backend, currently only `openai`
- `voice.transcription.model`: OpenAI transcription model, for example `gpt-4o-mini-transcribe`
- `voice.transcription.language`: optional ISO-639-1 language hint such as `en`
- `document.maxDownloadBytes`: optional maximum Telegram document download size in bytes; defaults to `20971520`

CLI endpoints do not have additional public config fields.

File endpoint fields:

- `pluginId`: points to an enabled top-level `plugins[].id`
- `ingress.pollIntervalMs`: optional inbox polling interval in milliseconds; defaults to `1000`
- `ingress.maxEventBytes`: optional maximum JSON event file size in bytes; defaults to `262144`
- `response.type`: `none`, `endpoint`, or `outbox`
- `response.endpointId`: for `endpoint` responses, the configured endpoint that receives agent replies
- `response.target.conversationId`: for `endpoint` responses, the target conversation or chat identifier for that endpoint
- `response.target.userId`: optional target user identifier for endpoints that need it
- `response.replyChannel.kind`: required for `outbox` responses; declares the semantic reply channel exposed to prompt templates, such as `audio`

Top-level plugin fields:

- `id`: unique plugin identifier
- `enabled`: whether endpoints may bind to this plugin
- `package.path`: optional operator-facing path to the local plugin package or component
- `package.source.version`: plugin manifest version recorded at install time
- `package.source.manifestHash`: `sha256:` hash of the installed manifest recorded at install time
- `package.command`, `package.args`, `package.env`: optional launch metadata for operators and future service integration

Installable plugin manifests:

- npm plugin packages are installed into `<paths.dataRoot>/plugins/npm`
- local installable plugins are discovered from explicit plugin roots containing direct subdirectories with `plugin.json`
- `imp plugin list` lists discovered manifests
- `imp plugin inspect <id>` prints one manifest summary
- `imp plugin install <package-spec>` installs an npm package, then adds the manifest's plugin entry, endpoint defaults, and MCP server defaults to a config
- `--root <path>` scans an explicit plugin root
- `IMP_PLUGIN_PATH` can provide additional plugin roots, separated with the platform path delimiter
- manifest `schemaVersion` is currently `1`

`imp chat` always has a local CLI endpoint available. If no CLI endpoint is configured, it uses `local-cli`. Configured CLI endpoints are optional named chat profiles for `imp chat --endpoint <id>`; they are not started by `imp start` or the service, and chat uses `defaults.agentId` rather than `routing.defaultAgentId`.

Only enabled daemon endpoints are started by `imp start` and the service. At least one non-CLI endpoint must be enabled for daemon startup.

Skill discovery notes:

- each `agents[].skills.paths` entry is resolved relative to the config file when needed
- `imp` scans only direct subdirectories of each skill root for `SKILL.md`
- on each user turn, `imp` also scans `paths.dataRoot/skills`, `agent.home/.skills`, and, if the active agent has an explicit working directory, `<working-directory>/.skills`
- the effective working directory is `conversation.state.workingDirectory` or `agent.workspace.cwd`
- automatic `.skills` loading does not fall back to the daemon process working directory
- auto-discovered skill directories are discovered fresh on each turn, so edits take effect without a daemon restart
- `SKILL.md` must have valid YAML frontmatter with at least `name` and `description`
- invalid configured skills are ignored and logged during startup, and discovered configured skill names are logged per agent
- invalid auto-discovered skills are ignored and logged on the affected turn
- duplicate skill names across configured `agents[].skills.paths` are rejected and all colliding configured entries are ignored
- skill catalogs are merged in this order: `paths.dataRoot/skills`, `agent.home/.skills`, configured `agents[].skills.paths`, then `<working-directory>/.skills`
- later skill sources override earlier sources with the same skill name for that turn
- available skills are always available to prompt file templates as metadata only: skill directory path, `SKILL.md` path, skill name, and skill description
- when available skills exist, the `load_skill` tool is enabled automatically for that turn
- `load_skill` returns the selected skill's `SKILL.md` instructions, the absolute skill directory, and a `<skill_resources>` list of bundled `scripts/` and `references/` files
- `load_skill` does not return bundled resource contents; scripts and references can be documented from `SKILL.md` and inspected through normal filesystem tools when needed

Voice transcription notes:

- Voice support only accepts Telegram `voice` messages, not arbitrary audio uploads.
- When enabled, voice messages are transcribed into plain text before they reach the application layer.
- The transcript is shown in Telegram before the agent reply, but sessions remain text-centric and store the transcript text rather than the original audio.
- OpenAI transcription requires `OPENAI_API_KEY` in the runtime environment or service environment.

Telegram document notes:

- Private Telegram `document` attachments from allowed users are downloaded to the active session's `attachments/` directory.
- The user message remains text-centric. Captions are used as the message text, and messages without captions say that a document was uploaded.
- The agent receives explicit document context with the original Telegram metadata and local saved path.
- Photos and image understanding are not enabled by document support.

## Relative Paths

If a config file contains relative paths, `imp` resolves them relative to the config file directory.

This applies to:

- prompt files
- instruction files
- reference files
- `authFile`
- secret reference files such as `endpoints[].token.file`
- `workspace.cwd`

## Service Environment

Provider credentials and other service-only environment variables are not stored in `config.json`.
Telegram endpoint tokens may stay inline for compatibility, but environment-variable or secret-file references are the preferred operational pattern.

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

- which endpoints are `enabled`
- each endpoint's `routing.defaultAgentId`
- each agent's `model.provider` and `model.modelId`
- each agent's `authFile`, if used
- each agent's `prompt.base`, `prompt.instructions`, and `prompt.references`
- each agent's `workspace.cwd` and `workspace.shellPath`, if used
- whether required provider credentials are present in the interactive environment or, for Linux services, in `service.env`
- whether each endpoint token resolves from its inline value, environment variable, or secret file as intended

## Updating Config Values

Read a value:

```bash
imp config get endpoints.0.enabled
```

Set a value:

```bash
imp config set logging.level '"debug"'
```

Set arrays or objects with JSON:

```bash
imp config set endpoints.0.access.allowedUserIds '["123456789"]'
```

Validate after changes:

```bash
imp config validate
```

## Example Config

See [`config.example.json`](../config.example.json) for a fuller multi-agent example.

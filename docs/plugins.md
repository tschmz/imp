# Plugins

Plugins are external local components that exchange files with `imp`. They are not loaded into the daemon process, and `imp` does not execute plugin code as part of message handling.

Runtime hooks used by tests or library embedding are internal extensions, not installable plugins. Installable plugins should extend agents through external protocols such as file ingress/outbox and MCP companion services rather than daemon-loaded JavaScript.

The model is intentionally explicit:

- declare each plugin under top-level `plugins`
- bind a plugin to an endpoint with `type: "file"`
- let the external component write JSON event files into the endpoint inbox
- choose where agent replies go with `response`

## Installable Plugin Manifests

Installable plugins are npm packages with a `plugin.json` manifest:

```text
@tschmz/imp-voice/
  package.json
  plugin.json
```

Local development plugins can still live under a plugin root as direct subdirectories:

```text
local-plugins/
  my-plugin/
    plugin.json
```

Operators normally install plugins by passing an npm package spec. Local plugin roots are only scanned when `--root` or `IMP_PLUGIN_PATH` is used.

```bash
imp plugin list
imp plugin list --root /opt/imp/plugins
imp plugin inspect my-plugin --root /opt/imp/plugins
imp plugin doctor my-plugin --config ~/.config/imp/config.json
imp plugin status my-plugin --config ~/.config/imp/config.json
imp plugin install @tschmz/imp-voice@latest --config ~/.config/imp/config.json
imp plugin install ./my-plugin-0.1.0.tgz --config ~/.config/imp/config.json
```

When no local manifest matches the install argument, `imp` treats it as an npm package spec and installs it into the configured data root:

```text
<paths.dataRoot>/plugins/npm/
  package.json
  node_modules/
    @tschmz/imp-voice/
      plugin.json
```

Relative `paths.dataRoot` values are resolved against the config file directory. The installed config still stores `package.path` as the concrete package directory so service installation can read the manifest without consulting npm.

The manifest schema is versioned separately from the runtime file protocol:

```json
{
  "schemaVersion": 1,
  "id": "imp-voice",
  "name": "imp Voice",
  "version": "0.1.0",
  "description": "Local voice frontend for imp.",
  "capabilities": ["voice", "audio", "wake-word", "speech-output"],
  "endpoints": [
    {
      "id": "audio-ingress",
      "ingress": {
        "pollIntervalMs": 500,
        "maxEventBytes": 65536
      },
      "response": {
        "type": "outbox",
        "replyChannel": {
          "kind": "audio"
        }
      }
    }
  ],
  "services": [
    {
      "id": "wake",
      "command": "node",
      "args": ["dist/wake-service.js"],
      "env": {
        "OPENAI_API_KEY": "required"
      }
    },
    {
      "id": "speaker",
      "command": "node",
      "args": ["dist/speaker-service.js"],
      "env": {
        "OPENAI_API_KEY": "required"
      }
    }
  ],
  "mcpServers": [
    {
      "id": "voice-control",
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "inheritEnv": ["OPENAI_API_KEY"],
      "env": {
        "OPENAI_API_KEY": "required"
      }
    }
  ],
  "init": {
    "configTemplate": "templates/config.default.json"
  }
}
```

The install command writes the manifest defaults into an existing config:

- adds a top-level `plugins[]` entry with `enabled: true`
- sets `package.path` to the discovered plugin directory
- records `package.source.version` and `package.source.manifestHash` from the installed manifest
- adds each manifest endpoint as an enabled `type: "file"` endpoint
- adds each manifest MCP server to top-level `tools.mcp.servers`
- fails if the plugin ID, endpoint ID, or MCP server ID already exists

This manifest API defines plugin identity, default endpoint bindings, companion services, and init metadata so `imp init` and service-install flows can install a plugin without loading plugin code into the daemon process.

`imp plugin doctor <id>` checks the configured plugin entry, package path, manifest, file endpoints, and expected runtime directories. `imp plugin status <id>` prints the same health result in one line for scripts and quick checks.

Plugins can declare a Python setup for companion services:

```json
{
  "setup": {
    "python": {
      "requirements": "requirements.txt"
    }
  },
  "services": [
    {
      "id": "wake",
      "command": "bash",
      "args": ["bin/wake-phrase"],
      "env": {
        "IMP_VOICE_PYTHON": "{{setup.python.venvPython}}"
      }
    }
  ]
}
```

Before service installation, `imp` creates the environment under `<paths.dataRoot>/plugins/state/<plugin-id>/python/.venv` and installs the requirements file from the plugin package. Services can reference the prepared interpreter with `{{setup.python.venvPython}}`.

Plugins can declare MCP server defaults in `mcpServers[]`. `imp` installs those declarations into top-level `tools.mcp.servers`, but it does not automatically attach them to agents. Operators should opt agents into plugin MCP servers explicitly so tool access remains agent-scoped. MCP servers can use `inheritEnv` to allowlist environment variables from the `imp` process environment without writing secret values into `config.json`.

## Example: Audio Frontend To Telegram

A Raspberry Pi audio frontend can run as its own local service, recognize speech, and write an event file into the `imp` inbox. `imp` routes the text to an agent and sends the reply to Telegram:

```json
{
  "plugins": [
    {
      "id": "pi-audio",
      "enabled": true,
      "package": {
        "path": "/opt/imp/plugins/pi-audio"
      }
    }
  ],
  "endpoints": [
    {
      "id": "private-telegram",
      "type": "telegram",
      "enabled": true,
      "token": {
        "env": "IMP_PRIVATE_TELEGRAM_BOT_TOKEN"
      },
      "access": {
        "allowedUserIds": ["123456789"]
      }
    },
    {
      "id": "audio-ingress",
      "type": "file",
      "enabled": true,
      "pluginId": "pi-audio",
      "routing": {
        "defaultAgentId": "default"
      },
      "ingress": {
        "pollIntervalMs": 500,
        "maxEventBytes": 65536
      },
      "response": {
        "type": "endpoint",
        "endpointId": "private-telegram",
        "target": {
          "conversationId": "123456789"
        }
      }
    }
  ]
}
```

## Runtime Directories

For file endpoint `audio-ingress` bound to plugin `pi-audio`, the runtime files live at:

```text
<paths.dataRoot>/runtime/plugins/pi-audio/endpoints/audio-ingress/
  inbox/
  processing/
  processed/
  failed/
  outbox/
```

Directory behavior:

- `inbox`: the plugin writes event files here
- `processing`: `imp` moves a claimed event here while it is being processed
- `processed`: successfully handled event files end up here
- `failed`: invalid or failed event files end up here with a sibling `.error.json` record
- `outbox`: agent replies are written here when `response.type` is `outbox`

`imp` creates these directories during daemon startup. Operators can inspect them directly to understand what happened to an event.

## Event Files

Plugin event files are UTF-8 JSON files with a `.json` suffix.

Required field:

- `text`: recognized text to send to the agent

Optional fields:

- `schemaVersion`: plugin event schema version. Use `1`; omitted means legacy version `1`
- `id`: event identifier; defaults to a value derived from the file name claimed by `imp`
- `correlationId`: correlation identifier for logs and conversation records
- `conversationId`: plugin conversation identifier; defaults to the plugin ID
- `userId`: plugin user or device identifier; defaults to the plugin ID
- `receivedAt`: ISO timestamp; defaults to the ingestion time
- `metadata`: JSON object stored as source metadata on the inbound message

Example event:

```json
{
  "schemaVersion": 1,
  "id": "wake-2026-04-17T00-15-30Z",
  "conversationId": "kitchen",
  "userId": "raspberry-pi",
  "text": "turn on the kitchen lights",
  "metadata": {
    "confidence": 0.94,
    "wakeWord": "computer"
  }
}
```

Write files atomically from the plugin side: write to a temporary file outside `inbox`, then rename it into `inbox` with a `.json` suffix.

## Response Routing

File endpoints choose one response route:

```json
{
  "response": {
    "type": "none"
  }
}
```

`none` processes the inbound message and discards the agent reply.

```json
{
  "response": {
    "type": "endpoint",
    "endpointId": "private-telegram",
    "target": {
      "conversationId": "123456789"
    }
  }
}
```

`endpoint` sends the agent reply through an enabled endpoint that supports targeted delivery. Telegram supports this by sending to the configured chat ID.

```json
{
  "response": {
    "type": "outbox",
    "replyChannel": {
      "kind": "audio"
    },
    "priority": "normal",
    "ttlMs": 30000,
    "speech": {
      "enabled": true,
      "language": "de",
      "model": "gpt-4o-mini-tts",
      "voice": "ash",
      "instructions": "Use short spoken replies."
    }
  }
}
```

`outbox` writes a JSON reply file to the file endpoint outbox. This keeps a local speaker-output component outside the daemon process. `replyChannel.kind` is required for prompt context and describes the semantic channel that will consume the outbox reply. Use `"audio"` for a Raspberry Pi voice playback component. `imp` does not infer audio from `outbox`.

Optional outbox controls:

- `priority`: `low`, `normal`, or `high`; defaults to `normal`
- `ttlMs`: advisory time-to-live for consumers that should skip stale replies
- `speech.enabled`: set `false` when an audio consumer should not speak the reply
- `speech.language`, `speech.model`, `speech.voice`, and `speech.instructions`: advisory TTS hints for speech consumers

Prompt files receive explicit reply-channel context:

- normal endpoint conversations set `reply.channel.kind` to the endpoint transport, such as `telegram` or `cli`
- plugin `response.type: "endpoint"` sets `reply.channel.kind` from the target endpoint transport and `reply.channel.endpointId` from the target endpoint ID
- plugin `response.type: "outbox"` sets `reply.channel.kind` from `response.replyChannel.kind`
- plugin `response.type: "none"` sets `reply.channel.kind` to `none`

Put channel-specific behavior, such as Telegram formatting or audio-friendly wording, in prompt files by checking `reply.channel.kind`. Do not rely on hidden daemon code to add channel instructions.

Individual plugin event files may override delivery with `"response": { "type": "none" }`. This suppresses the configured endpoint response for that one event and exposes `reply.channel.kind = "none"` to the agent. Use this for internal follow-up events, such as asking an agent to update notes after an audio or phone session has ended.

Plugin events may request detached sessions. Detached session `kind` and `metadata` are exposed to prompt templates as `conversation.kind` and `conversation.metadata`. This lets a plugin add prompt-visible call or device context without mixing the session with the initiating chat.

For example, imp-phone writes `conversation.kind = "phone-call"` and exposes `contact_id`, `contact_name`, and `contact_uri` through `conversation.metadata`.

Outbox files include:

- `schemaVersion`
- `id`
- `eventId`
- `correlationId`
- `conversationId`
- `userId`
- `replyChannel`
- `priority`
- `ttlMs`, when configured
- `speech`, when configured
- `text`
- `createdAt`

## Failure Records

When an event file is invalid or processing fails, `imp` moves the event to `failed/` and writes `<event-file>.error.json` next to it.

The error record includes:

- original file name
- endpoint ID
- plugin ID
- failure timestamp
- error type
- error message

The endpoint log also records the failed path and error record path.

## File Protocol Smoke Test

With a running daemon and an enabled file endpoint, write one event into the endpoint inbox:

```bash
cat > <paths.dataRoot>/runtime/plugins/pi-audio/endpoints/audio-ingress/inbox/smoke.json <<'JSON'
{
  "schemaVersion": 1,
  "id": "smoke-1",
  "conversationId": "smoke",
  "userId": "smoke",
  "text": "Say a short smoke-test reply.",
  "receivedAt": "2026-04-18T00:00:00Z",
  "metadata": {
    "source": "manual-smoke-test"
  }
}
JSON
```

Expected result:

- the event file moves from `inbox/` to `processing/` and then `processed/`
- invalid files move to `failed/` with a sibling `.error.json`
- when `response.type` is `outbox`, a reply appears in `outbox/`
- when `response.type` is `endpoint`, the configured endpoint receives the reply

For Raspberry Pi audio frontends, the companion service can then process one outbox reply with its own `--once` mode.

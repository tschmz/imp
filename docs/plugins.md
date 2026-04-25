# Plugins

Plugins are local companion components that exchange files with Imp. They are not loaded into the daemon process, and Imp does not execute plugin code while handling a message.

A plugin usually provides one or more file endpoints, optional companion services, and optional MCP server defaults. The external component writes event files into an inbox, Imp routes the text to an agent, and the configured response route decides where the reply goes.

## Inspect Plugins

List installable plugins:

```sh
imp plugin list
```

Inspect one plugin:

```sh
imp plugin inspect my-plugin
```

Local development plugin roots are scanned only when you pass `--root` or set `IMP_PLUGIN_PATH`:

```sh
imp plugin list --root /opt/imp/plugins
imp plugin inspect my-plugin --root /opt/imp/plugins
```

## Install a Plugin

Install from an npm package spec:

```sh
imp plugin install @tschmz/imp-voice@latest --config ~/.config/imp/config.json
```

Install from a local package archive:

```sh
imp plugin install ./my-plugin-0.1.0.tgz --config ~/.config/imp/config.json
```

The install command updates the config by adding:

- A top-level `plugins[]` entry
- File endpoints declared by the plugin manifest
- MCP server defaults declared by the plugin manifest
- Package metadata such as the plugin path, version, and manifest hash

Plugin MCP servers are not attached to agents automatically. Enable them per agent in [Agent Tools](./agent-tools.md).

## Check a Plugin

Check a configured plugin installation:

```sh
imp plugin doctor my-plugin --config ~/.config/imp/config.json
```

Print a short health line for scripts:

```sh
imp plugin status my-plugin --config ~/.config/imp/config.json
```

These commands inspect the configured plugin entry, package path, manifest, file endpoints, and expected runtime directories.

## File Endpoint Flow

A file endpoint connects one configured plugin to one inbox/outbox directory tree under `paths.dataRoot`.

For plugin `pi-audio` and endpoint `audio-ingress`, runtime files live at:

```text
<paths.dataRoot>/runtime/plugins/pi-audio/endpoints/audio-ingress/
  inbox/
  processing/
  processed/
  failed/
  outbox/
```

The directories mean:

- `inbox`: the plugin writes event files here
- `processing`: Imp moves a claimed event here while it is being processed
- `processed`: successfully handled event files end up here
- `failed`: invalid or failed event files end up here with a sibling `.error.json`
- `outbox`: Imp writes reply files here when the endpoint uses `response.type: "outbox"`

Imp creates these directories during daemon startup.

## Event Files

Plugin events are UTF-8 JSON files with a `.json` suffix. The only required field is `text`.

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

Optional fields include:

- `schemaVersion`: use `1`; omitted means version `1`
- `id`: event identifier
- `correlationId`: correlation identifier for logs and conversation records
- `conversationId`: plugin conversation identifier
- `userId`: plugin user or device identifier
- `receivedAt`: ISO timestamp
- `metadata`: JSON object stored as source metadata
- `session`: detached session details for plugin-managed conversations
- `response`: per-event response override; currently only `{"type":"none"}`

Write event files atomically from the plugin side: write a temporary file outside `inbox`, then rename it into `inbox` with a `.json` suffix.

## Response Routing

File endpoints choose one response route.

Use `none` when the agent reply should be discarded:

```json
{
  "type": "none"
}
```

Use `endpoint` when the reply should be sent through another enabled endpoint, such as Telegram:

```json
{
  "type": "endpoint",
  "endpointId": "private-telegram",
  "target": {
    "conversationId": "123456789"
  }
}
```

Use `outbox` when a local component should consume the reply from the file endpoint outbox:

```json
{
  "type": "outbox",
  "replyChannel": {
    "kind": "audio"
  },
  "priority": "normal",
  "ttlMs": 30000
}
```

`replyChannel.kind` is exposed to prompt templates as `reply.channel.kind`. Use it in the system prompt when an agent should answer differently for a spoken reply, a chat reply, or an internal event.

## Outbox Messages

Outbox reply files include:

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

`speech` fields are advisory hints for local speech consumers. Imp writes them to the outbox message but does not perform text-to-speech itself.

## Failure Records

When an event file is invalid or processing fails, Imp moves the event to `failed/` and writes `<event-file>.error.json` next to it.

The error record includes:

- Original file name
- Endpoint ID
- Plugin ID
- Failure timestamp
- Error type
- Error message

The endpoint log also records the failed path and error record path.

## Smoke Test

With a running daemon and an enabled file endpoint, write one event into the endpoint inbox:

```sh
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

- The event file moves from `inbox/` to `processing/` and then `processed/`
- Invalid files move to `failed/` with a sibling `.error.json`
- When `response.type` is `outbox`, a reply appears in `outbox/`
- When `response.type` is `endpoint`, the configured endpoint receives the reply

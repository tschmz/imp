# Plugins

Plugins add local companion integrations to Imp. A plugin can add file endpoints, background services, MCP server defaults, specialized agents, skills, command tools, or trusted in-process tools.

Use plugins when you want Imp to talk to something local, such as a voice pipeline, phone controller, or packaged agent pack.

## Find and Inspect Plugins

List installable plugins:

```sh
imp plugin list
```

Inspect one plugin before installing it:

```sh
imp plugin inspect imp-voice
```

For a custom plugin directory:

```sh
imp plugin list --root /path/to/plugins
imp plugin inspect my-plugin --root /path/to/plugins
```

## Install a Plugin

Install from npm:

```sh
imp plugin install @tschmz/imp-voice@latest
```

Install from a local package archive:

```sh
imp plugin install /path/to/my-plugin-0.1.0.tgz
```

Install into a specific config:

```sh
imp plugin install @tschmz/imp-voice@latest --config /path/to/config.json
```

Run `imp plugin install` again to update a configured plugin to the requested plugin ID, package spec, or local plugin manifest.

The install command can update the config with:

- A top-level plugin entry
- File endpoints declared by the plugin
- MCP server defaults declared by the plugin
- Package path, version, and manifest metadata
- Plugin services, when the plugin declares managed services

Plugin agents and skills are loaded from the installed package at runtime. Plugin-provided agents use namespaced IDs such as `imp-agents.cody`.

Tools from plugins under an agent home at `<agent.home>/.plugins/*` are also attached to that agent automatically at run time. This lets an agent extend itself with local plugin tools without editing the agent tool list or restarting the daemon.

Plugin MCP servers are not attached to agents automatically. Enable them per agent in [Agent Tools](./agent-tools.md).

## Check a Plugin

Check a configured plugin installation:

```sh
imp plugin check imp-voice
```

Print a short status line:

```sh
imp plugin status imp-voice
```

These commands inspect the configured plugin entry, package path, manifest, file endpoints, and expected runtime directories.

## File Endpoint Flow

Many plugins use a file endpoint. The plugin writes an event JSON file into an inbox. Imp moves it through processing directories, sends the text to an agent, and writes or routes the reply.

For plugin `pi-audio` and endpoint `audio-ingress`, runtime files live under:

```text
<paths.dataRoot>/runtime/plugins/pi-audio/endpoints/audio-ingress/
  inbox/
  processing/
  processed/
  failed/
  outbox/
```

Directory meanings:

- `inbox`: plugin writes event files here
- `processing`: Imp places a claimed event here while handling it
- `processed`: successful event files end here
- `failed`: invalid or failed event files end here with an `.error.json` file
- `outbox`: Imp writes replies here when the endpoint uses `response.type: "outbox"`

Imp creates these directories during daemon startup.

## Event Files

Plugin events are UTF-8 JSON files with a `.json` suffix. The only required field is `text`.

```json
{
  "schemaVersion": 1,
  "id": "smoke-1",
  "conversationId": "kitchen",
  "userId": "local-device",
  "text": "turn on the kitchen lights",
  "metadata": {
    "source": "manual-smoke-test"
  }
}
```

Optional fields include `id`, `correlationId`, `conversationId`, `userId`, `receivedAt`, `metadata`, `session`, and `response`.

Write event files atomically: write a temporary file outside `inbox`, then rename it into `inbox` with a `.json` suffix.

## Response Routing

A file endpoint chooses one response route.

Discard replies:

```json
{ "type": "none" }
```

Send replies through another endpoint, such as Telegram:

```json
{
  "type": "endpoint",
  "endpointId": "private-telegram",
  "target": {
    "conversationId": "123456789"
  }
}
```

Write replies to the endpoint outbox:

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

`replyChannel.kind` is available to prompt templates as `reply.channel.kind`.

## Smoke Test

With the daemon running and a file endpoint enabled, write one event into the endpoint inbox:

```sh
cat > <paths.dataRoot>/runtime/plugins/pi-audio/endpoints/audio-ingress/inbox/smoke.json <<'JSON'
{
  "schemaVersion": 1,
  "id": "smoke-1",
  "conversationId": "smoke",
  "userId": "smoke",
  "text": "Say a short smoke-test reply."
}
JSON
```

Expected result:

- The event moves from `inbox/` to `processing/` and then `processed/`
- Invalid files move to `failed/` with an `.error.json` file
- If response type is `outbox`, a reply appears in `outbox/`
- If response type is `endpoint`, the configured endpoint receives the reply

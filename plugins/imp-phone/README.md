# imp Phone

`imp-phone` is a turn-based SIP phone frontend for `imp`.

It is intentionally modeled after `imp-voice`: companion processes exchange JSON files with an `imp` plugin endpoint. The difference is the audio boundary. Instead of a local microphone and speaker, `imp-phone` expects the SIP client audio to be routed through configurable capture and playback commands.

## Runtime Flow

```text
phone_call tool
  -> call request JSON
  -> imp-phone controller
  -> SIP command, for example baresip
  -> wait for registration, ringing, and answered state
  -> capture caller audio
  -> STT
  -> plugin inbox JSON
  -> imp agent
  -> plugin outbox JSON
  -> TTS
  -> playback into the SIP audio input
```

The first implementation is turn-based, not full duplex. The caller speaks, silence ends the turn, the agent answers, and the next turn starts.

The controller writes `phone-status.json` with `state`, `phase`, and `can_speak` fields modeled after `imp-voice` runtime status. Important phases include:

- `calling`
- `ringing`
- `answered`
- `recording_command`
- `transcribing_command`
- `waiting_for_speaker`
- `speaking`
- `conversation_closed`

## Install

From npm:

```bash
imp plugin install @tschmz/imp-phone --config ~/.config/imp/config.json
```

For local development from the `imp` repository:

```bash
imp plugin install imp-phone --root plugins --config ~/.config/imp/config.json
```

Package installs are stored below the active config's `paths.dataRoot` at `plugins/npm`.

The install command adds:

- top-level plugin `imp-phone`
- endpoint `phone-ingress`
- outbox response routing with `replyChannel.kind = "phone"`
- auto-started `imp-phone-controller` service

The install command does not add phone contacts to an agent. Contacts are allowlisted per agent and must be configured explicitly in `agents[].tools.phone`.

## Call Requests

The controller watches `requestsDir` for request files. The `phone_call` tool can be wired to create those files by running `bin/request-call.mjs` from the installed package.
The tool automatically passes the calling agent id through `IMP_PHONE_AGENT_ID`, so phone call sessions stay attached to the agent that initiated the call.

Example `agents[].tools.phone` config:

```json
{
  "command": "node",
  "args": [
    "/home/thomas/.local/state/imp/plugins/npm/node_modules/@tschmz/imp-phone/bin/request-call.mjs",
    "--requests-dir",
    "/home/thomas/.local/state/imp/runtime/plugins/imp-phone/requests",
    "--contact-id",
    "{contactId}",
    "--contact-name",
    "{contactName}",
    "--uri",
    "{uri}"
  ],
  "contacts": [
    {
      "id": "thomas",
      "name": "Thomas",
      "uri": "+10000000000"
    }
  ]
}
```

Adjust the paths to your active `paths.dataRoot`. For local development from this repository, use the repository path to `plugins/imp-phone/bin/request-call.mjs` instead.

## Audio Bridge

The default controller config uses:

- `baresip`, waits for SIP registration, then sends `/dial {uri}` over stdin
- SIP progress output to wait for `ringing` and `answered` before recording caller audio
- `arecord -D imp_phone_remote_capture ... -t raw` to capture caller audio
- `aplay -D imp_phone_agent_playback -q {path}` to play TTS audio

While `imp` is working on a response, the controller can play a configurable hold message after `conversation.holdMessageAfterSeconds` and then every `conversation.holdMessageIntervalSeconds`.

Short feedback tones are available for `captured`, `accepted`, `error`, and `closed`. They are played through the same phone playback command and can be disabled with `feedbackTones.enabled = false`.

For real phone conversations, configure `baresip`, `arecord`, and `aplay` to use an ALSA/Pulse/PipeWire bridge where:

- SIP remote audio is readable by `capture.command`
- `playback.command` writes to the audio device that `baresip` sends as microphone input

One ALSA loopback setup is:

```text
baresip audio_player -> imp_phone_remote_playback
imp capture          <- imp_phone_remote_capture

imp playback         -> imp_phone_agent_playback
baresip audio_source <- imp_phone_agent_capture
```

With `snd-aloop`, those named PCMs can be defined in `~/.asoundrc`:

```text
pcm.imp_phone_remote_playback {
  type plug
  slave.pcm "hw:Loopback,0,0"
}

pcm.imp_phone_remote_capture {
  type plug
  slave.pcm "hw:Loopback,1,0"
}

pcm.imp_phone_agent_playback {
  type plug
  slave.pcm "hw:Loopback,0,1"
}

pcm.imp_phone_agent_capture {
  type plug
  slave.pcm "hw:Loopback,1,1"
}
```

Then set `baresip`:

```text
audio_player          alsa,imp_phone_remote_playback
audio_source          alsa,imp_phone_agent_capture
```

## Manual Request

```bash
node bin/request-call.mjs \
  --requests-dir /home/thomas/.imp/runtime/plugins/imp-phone/requests \
  --contact-id thomas \
  --contact-name Thomas \
  --uri +10000000000 \
  --agent-id imp.telebot
```

## Development

Run one controller pass:

```bash
OPENAI_API_KEY=... node bin/controller.mjs --config config/default.json --once
```

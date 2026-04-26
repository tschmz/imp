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
- MCP server `imp-phone`, which exposes `phone_call` and `phone_hangup` as Imp tools
- auto-started `imp-phone-controller` service

The install command does not add phone contacts to an agent. Contacts are allowlisted per agent and must be configured explicitly in `agents[].tools.phone`, and the agent must opt into the `imp-phone` MCP server.

## Call Requests

The controller watches `requestsDir` for request files. The packaged MCP server writes those files directly and waits until the controller reports whether the call was answered, timed out, or failed. The controller still owns the call timing through `call.registerTimeoutMs` and `call.answerTimeoutMs`; the tool only waits for the controller result.
The MCP server receives the calling agent id from Imp through `IMP_PHONE_AGENT_ID`, so phone call sessions stay attached to the agent that initiated the call. Optional contact comments and call purposes are written into the call request and become detached phone session metadata.
Agents can also use the packaged `phone_hangup` MCP tool. It writes a control command to `controlDir`, and the controller ends the active call after the current agent reply has been played.

When an answered call ends, the controller writes one final `call_closed` event into the same detached phone session with `"response": { "type": "none" }`. This gives the agent one internal turn to update contact notes without producing another phone reply or leaving an outbox message.

Example agent tool config:

```json
{
  "mcp": {
    "servers": ["imp-phone"]
  },
  "phone": {
    "contacts": [
      {
        "id": "thomas",
        "name": "Thomas",
        "uri": "+10000000000",
        "comment": "work colleague"
      }
    ]
  }
}
```

Imp prefixes MCP tool names with the server id, so the model sees `imp-phone__phone_call` and `imp-phone__phone_hangup`. The plugin install provides the default request and control directories. Use `phone.requestsDir` or `phone.controlDir` only when you need to override those paths.

## Audio Bridge

The default controller config uses:

- `baresip`, waits for SIP registration, then sends `/dial {uri}` over stdin
- SIP progress output to wait for `ringing` and `answered` before recording caller audio
- `arecord -D imp_phone_remote_capture ... -t raw` to capture caller audio
- `aplay -D imp_phone_agent_playback -q {path}` to play TTS audio

TTS providers:

- `openai` uses `OPENAI_API_KEY` by default and sends audio requests to OpenAI's speech API.
- `elevenlabs` uses `ELEVENLABS_API_KEY` by default and sends audio requests to ElevenLabs' text-to-speech API.

Example ElevenLabs controller config:

```json
{
  "tts": {
    "provider": "elevenlabs",
    "voice": "your-elevenlabs-voice-id",
    "model": "eleven_multilingual_v2",
    "format": "wav_16000"
  }
}
```

When using ElevenLabs, make sure the endpoint `response.speech.voice` value is also an ElevenLabs voice ID or omit the endpoint voice override so the local fallback is used.

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
  --comment "work colleague" \
  --agent-id imp.telebot \
  --wait
```

## Development

Run one controller pass:

```bash
OPENAI_API_KEY=... node bin/controller.mjs --config config/default.json --once
```

# imp Phone

`imp-phone` adds a turn-based SIP phone frontend to Imp. It lets an agent place or handle a phone-style conversation through a local SIP client and audio bridge.

The first implementation is turn-based rather than full duplex: the caller speaks, silence ends the turn, the agent answers, and the next turn starts.

## Runtime Flow

```text
phone_call tool
  -> call request JSON
  -> imp-phone controller
  -> SIP command, such as baresip
  -> capture caller audio
  -> speech-to-text
  -> Imp file endpoint
  -> agent reply
  -> text-to-speech
  -> playback into SIP audio input
```

## Install

Install the published plugin:

```sh
imp plugin install @tschmz/imp-phone
```

For a checked-out repository:

```sh
imp plugin install imp-phone --root plugins --config /path/to/config.json
```

The install command adds:

- Plugin entry `imp-phone`
- File endpoint `phone-ingress`
- Outbox response routing with `replyChannel.kind = "phone"`
- MCP server `imp-phone` for phone tools
- Managed `imp-phone-controller` service

Validate and reload:

```sh
imp config validate --preflight
imp config reload
```

## Enable Phone Tools for an Agent

The install command does not add contacts to an agent. Contacts are allowlisted per agent, and the agent must opt into the `imp-phone` MCP server.

```json
{
  "mcp": {
    "servers": ["imp-phone"]
  },
  "phone": {
    "contacts": [
      {
        "id": "office",
        "name": "Office",
        "uri": "+10000000000",
        "comment": "work contact"
      }
    ]
  }
}
```

Imp prefixes MCP tool names with the server ID, so the model sees `imp-phone__phone_call` and `imp-phone__phone_hangup`.

## Call Requests

The packaged MCP server writes request files for the controller and waits for the controller to report whether the call was answered, timed out, or failed.

The controller owns call timing through settings such as registration timeout and answer timeout. Optional contact comments and call purposes become detached phone session metadata.

When a call ends, the controller writes a final internal event so the agent can update notes without producing another phone reply.

## Audio Bridge

The default controller expects:

- A SIP command such as `baresip`
- A recording command such as `arecord`
- A playback command such as `aplay`
- A local audio bridge connecting SIP audio to Imp capture and playback

Text-to-speech providers:

- `openai`: uses `OPENAI_API_KEY`
- `elevenlabs`: uses `ELEVENLABS_API_KEY`

Example ElevenLabs settings:

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

## Example ALSA Loopback Layout

One possible audio bridge with `snd-aloop` is:

```text
SIP remote audio -> imp_phone_remote_playback
Imp capture      <- imp_phone_remote_capture

Imp playback     -> imp_phone_agent_playback
SIP microphone   <- imp_phone_agent_capture
```

Example `~/.asoundrc` entries:

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

Then configure the SIP client to use the matching playback and capture devices.

## Manual Request Test

For manual testing, write a call request with the helper script:

```sh
node bin/request-call.mjs \
  --requests-dir /path/to/data-root/runtime/plugins/imp-phone/requests \
  --contact-id office \
  --contact-name Office \
  --uri +10000000000 \
  --comment "work contact" \
  --agent-id default \
  --wait
```

## Development Smoke Test

Run one controller pass:

```sh
OPENAI_API_KEY=... node bin/controller.mjs --config config/default.json --once
```

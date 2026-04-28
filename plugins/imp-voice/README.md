# imp Voice

`imp-voice` adds local voice input and spoken replies to Imp. It runs companion services that exchange JSON files with an Imp file endpoint.

Use this plugin when you want a local wake phrase, speech-to-text, and text-to-speech flow connected to an Imp agent.

## Install

Install the published plugin:

```sh
imp plugin install @tschmz/imp-voice
```

For a checked-out repository:

```sh
imp plugin install imp-voice --root plugins --config /path/to/config.json
```

The install command adds:

- Plugin entry `imp-voice`
- File endpoint `audio-ingress`
- Outbox response routing with `replyChannel.kind = "audio"`
- Managed wake phrase service `imp-voice-in`
- Managed speaker service `imp-voice-out`

Validate and reload:

```sh
imp config validate --preflight
imp config reload
```

## Runtime Directory

The companion services and Imp communicate through the endpoint runtime directory:

```text
<paths.dataRoot>/runtime/plugins/imp-voice/endpoints/audio-ingress
```

The packaged services are configured during `imp plugin install`. For manual runs, set:

```sh
export IMP_VOICE_RUNTIME_DIR=/path/to/data-root/runtime/plugins/imp-voice/endpoints/audio-ingress
```

## Speech Providers

Text-to-speech providers:

- `openai`: uses `OPENAI_API_KEY`
- `elevenlabs`: uses `ELEVENLABS_API_KEY`

Example ElevenLabs speaker settings:

```json
{
  "speaker": {
    "tts": {
      "provider": "elevenlabs",
      "voice": "your-elevenlabs-voice-id",
      "model": "eleven_multilingual_v2",
      "format": "wav_16000"
    }
  }
}
```

When using ElevenLabs, make sure the endpoint speech voice is also an ElevenLabs voice ID, or omit the endpoint voice override.

## Wake Phrase Service

`imp plugin install` prepares a Python environment for the wake phrase service under the active data root:

```text
<paths.dataRoot>/plugins/state/imp-voice/python/.venv
```

The generated service environment points `IMP_VOICE_PYTHON` at that environment.

For manual testing:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
export IMP_VOICE_PYTHON="$PWD/.venv/bin/python"
```

## Manual Smoke Tests

Write one manual event:

```sh
node bin/write-event.mjs --config config/default.json --text "Are you there?"
```

Consume one outbox reply:

```sh
OPENAI_API_KEY=... node bin/speaker-outbox.mjs --config config/default.json --once
```

Run speaker consumption continuously:

```sh
OPENAI_API_KEY=... node bin/speaker-outbox.mjs --config config/default.json
```

Run wake phrase ingress continuously:

```sh
OPENAI_API_KEY=... bin/wake-phrase --config config/wake-phrase.toml
```

Use `--no-services` during plugin installation when you only want to update config and do not want managed services installed or started.

# imp Voice

`imp-voice` is a local file-protocol voice frontend for `imp`.

It is implemented as companion processes instead of code loaded into the `imp` daemon. The plugin writes user events into the configured plugin endpoint `inbox/`, and consumes agent replies from `outbox/`.

## Install

From npm:

```bash
imp plugin install @tschmz/imp-voice --config ~/.config/imp/config.json
```

For local development from the `imp` repository:

```bash
imp plugin install imp-voice --root plugins --config ~/.config/imp/config.json
```

Package installs are stored below the active config's `paths.dataRoot` at `plugins/npm`.

The install command adds:

- top-level plugin `imp-voice`
- endpoint `audio-ingress`
- `outbox` response routing with `replyChannel.kind = "audio"`
- auto-started `imp-voice-in` wake phrase background service
- auto-started `imp-voice-out` speaker background service

## Runtime Config

Copy and adapt `config/default.json`.

The important field is `runtimeDir`. It must match the endpoint runtime directory created by `imp`:

```text
<paths.dataRoot>/runtime/plugins/imp-voice/endpoints/audio-ingress
```

The bundled example config uses a relative development path:

```text
./runtime/plugins/imp-voice/endpoints/audio-ingress
```

For a deployed configuration, set `runtimeDir` to the active `paths.dataRoot`-based runtime path or export:

```bash
export IMP_VOICE_RUNTIME_DIR=/path/to/runtime/plugins/imp-voice/endpoints/audio-ingress
```

`speaker.tts` only contains local rendering fallbacks. The response-specific speech metadata comes from the imp outbox payload, which is written from the installed endpoint `response.speech` config.

TTS providers:

- `openai` uses `OPENAI_API_KEY` by default and sends audio requests to OpenAI's speech API.
- `elevenlabs` uses `ELEVENLABS_API_KEY` by default and sends audio requests to ElevenLabs' text-to-speech API.

Example ElevenLabs speaker config:

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

When using ElevenLabs, make sure the endpoint `response.speech.voice` value is also an ElevenLabs voice ID or omit the endpoint voice override so the local fallback is used.

## Wake Phrase Runtime

The `imp-voice-in` service uses the Python wake phrase stack from inside this plugin. `imp plugin install` prepares a Python virtual environment before installing auto-start services:

```text
<paths.dataRoot>/plugins/state/imp-voice/python/.venv
```

The generated service environment sets `IMP_VOICE_PYTHON` to that virtual environment. For manual development runs, create a plugin-local environment or set `IMP_VOICE_PYTHON` yourself:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
export IMP_VOICE_PYTHON="$PWD/.venv/bin/python"
```

The default wake phrase config is `config/wake-phrase.toml`. It uses these service environment variables:

```text
IMP_VOICE_RUNTIME_DIR=<paths.dataRoot>/runtime/plugins/imp-voice/endpoints/audio-ingress
IMP_VOICE_RECORDINGS_DIR=<paths.dataRoot>/runtime/plugins/imp-voice/recordings
IMP_VOICE_PYTHON=<paths.dataRoot>/plugins/state/imp-voice/python/.venv/bin/python
```

`imp plugin install` writes those values into the service environment files.

## Commands

Write one manual event:

```bash
node bin/write-event.mjs --config config/default.json --text "Are you there?"
```

Run newline-delimited text ingress for development:

```bash
node bin/text-ingress.mjs --config config/default.json
```

Consume one outbox reply:

```bash
OPENAI_API_KEY=... node bin/speaker-outbox.mjs --config config/default.json --once
```

Run speaker consumption continuously:

```bash
OPENAI_API_KEY=... node bin/speaker-outbox.mjs --config config/default.json
```

Run wake phrase ingress continuously:

```bash
OPENAI_API_KEY=... bin/wake-phrase --config config/wake-phrase.toml
```

`imp plugin install` installs and starts the `imp-voice-in` and `imp-voice-out` services automatically by default. Use `--no-services` when only the config changes should be applied.

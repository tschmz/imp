# Telegram

Telegram endpoints let you chat with an Imp agent from a private Telegram chat. Each endpoint needs a bot token and an allowlist of Telegram user IDs.

## Configure Telegram

The interactive setup can create a Telegram endpoint:

```sh
imp init
```

If your config already contains an endpoint named `private-telegram`, set its token from an environment variable:

```sh
imp config set endpoints.private-telegram.token '{"env":"IMP_TELEGRAM_BOT_TOKEN"}'
```

Allow your Telegram user ID:

```sh
imp config set endpoints.private-telegram.access.allowedUserIds '["123456789"]'
```

Validate:

```sh
imp config validate
```

Use `/whoami` in Telegram once the bot is reachable to confirm chat and user IDs.

## Start Telegram

Start enabled daemon endpoints:

```sh
imp start
```

Or install and start Imp as a background service:

```sh
imp service install
imp service start
```

After changing endpoint config, run:

```sh
imp config reload
```

If the service environment changed, restart the service directly.

## Chat Commands

Enter `/help` in Telegram to view commands.

Common commands:

| Command | Purpose |
| --- | --- |
| `/new [title]` | Start a fresh session for the selected agent |
| `/status` | Show the current session details |
| `/history` | List previous sessions for the selected agent |
| `/resume <n>` | Resume a session from `/history` |
| `/rename <title>` | Rename the current session |
| `/reset` | Clear current session messages while keeping title and agent |
| `/export` | Export the current session transcript |
| `/agent` | Show the selected agent |
| `/agent <id>` | Switch this chat to another configured agent |
| `/config` | Show runtime and config details for the endpoint |
| `/logs` | Show recent daemon log lines |
| `/reload` | Exit after replying so a supervisor can reload config |
| `/restart` | Ask the supervisor to start a fresh daemon process |
| `/ping` | Check whether the endpoint is alive |
| `/whoami` | Show endpoint, chat, and user IDs |

## Agent Selection

A chat starts with the endpoint's default agent. Switching agents does not rewrite another agent's session; it points the chat at the selected agent's own active session.

## Voice Messages

Private Telegram voice messages can be transcribed before they reach the agent:

```sh
imp config set endpoints.private-telegram.voice '{"enabled":true,"transcription":{"provider":"openai","model":"gpt-4o-mini-transcribe"}}'
```

Voice transcription requires `OPENAI_API_KEY` in the runtime environment. The transcript is shown in Telegram and stored as text in the session.

## Documents and Images

Documents, image documents, and Telegram photos from allowed users are downloaded into the active session under `attachments/`.

Captions become the user message text. If a file has no caption, Imp tells the agent a file was uploaded and includes attachment details. If the selected model supports image input, Imp sends images to the model along with text context.

Set a download limit when needed:

```sh
imp config set endpoints.private-telegram.document.maxDownloadBytes 20971520
```

The default limit is 20 MiB.

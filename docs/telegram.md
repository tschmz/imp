# Telegram

Telegram endpoints let you chat with an Imp agent from a private Telegram chat. The endpoint needs a bot token and an allowlist of Telegram user IDs.

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

Validate the config:

```sh
imp config validate
```

Use `/whoami` in a reachable Telegram chat to see the current chat and user IDs.

## Start the Endpoint

Start enabled daemon endpoints:

```sh
imp start
```

If Imp is installed as a background service, restart or reload the service after changing endpoint config.

## Commands

Enter `/help` in Telegram to view available commands.

Common commands are:

- `/new`: start a fresh session for the current agent
- `/start`: same as `/new`
- `/status`: show the current session details
- `/history`: list previous sessions for the current agent
- `/resume <n>`: resume a session from `/history`
- `/rename <title>`: rename the current session
- `/reset`: clear the current session messages while keeping its title and agent
- `/export`: export the current session transcript
- `/agent`: show the selected agent
- `/agent <id>`: switch this chat to another configured agent
- `/config`: show runtime and config details for the endpoint
- `/logs`: show recent daemon log lines
- `/reload`: ask the daemon to exit so a supervisor can restart it with fresh config
- `/restart`: same restart behavior as `/reload`
- `/ping`: check whether the endpoint is alive
- `/whoami`: show endpoint, chat, and user IDs

## Agent Selection

A chat's selected agent starts from the endpoint's `routing.defaultAgentId`, or from `defaults.agentId` when the endpoint has no override.

Switching agents does not rewrite an existing session. It points the chat at the selected agent's active session.

## Voice Messages

Private Telegram voice messages can be transcribed before they reach the agent:

```sh
imp config set endpoints.private-telegram.voice '{"enabled":true,"transcription":{"provider":"openai","model":"gpt-4o-mini-transcribe"}}'
```

Voice transcription requires `OPENAI_API_KEY` in the runtime environment. The transcript is shown in Telegram and stored as text in the session.

## Documents And Images

Private Telegram document attachments from allowed users are downloaded into the active session under `attachments/`.

Captions become the user message text. If a document has no caption, Imp sends the agent a message that says a document was uploaded and includes the local saved path.

Image documents and Telegram photos are also downloaded into `attachments/`. If the selected model supports image input, Imp sends the image bytes to the agent along with the text context. If the model does not support image input, the agent still receives the saved path, relative path, MIME type, size, and Telegram file IDs as text context.

Set a document download limit when needed:

```sh
imp config set endpoints.private-telegram.document.maxDownloadBytes 20971520
```

The same download limit applies to normal documents, image documents, and Telegram photos. The default limit is 20 MiB.

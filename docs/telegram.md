# Telegram Commands

Telegram endpoints register their command menu automatically on startup for each configured endpoint.

These commands are part of the built-in Telegram UX. They control sessions, diagnostics, and daemon lifecycle from chat.

Current commands:

- `/help` shows the available commands.
- `/whoami` shows the current endpoint, chat, and user IDs.
- `/new` starts a fresh session for the chat's current agent and keeps the previous session available in `/history`.
- `/start` is an alias for `/new`.
- `/rename <title>` sets a title for the current agent's active session.
- `/reset` resets the messages in the current agent's active session while preserving its title and agent.
- `/status` shows the current agent's active session details, including title, agent, message count, timestamps, working directory, and how many previous sessions are available.
- `/history` lists previous sessions for the current agent and their transcript entry counts.
- `/restore <n>` switches the current agent to session `n` from `/history`.
- `/export` writes the current agent's active session transcript to an HTML file and replies with the file path and link. Use `/export full` to include complete tool arguments, tool output, and technical details; the default readable export keeps tool details compact.
- `/ping` returns a simple liveness response.
- `/config` shows runtime and config details for the current endpoint, including instance name, config path, data root, logging level, enabled endpoints, and the endpoint's default agent.
- `/agent` shows the chat's currently selected agent details, including provider, model, base prompt, home, auth file, instructions, references, workspace, skills, tools, and available agent IDs.
- `/agent <id>` switches this chat to that agent's active session and shows its details.
- `/logs` shows the last 20 daemon log lines for the current endpoint.
- `/logs <lines>` shows that many recent daemon log lines for the current endpoint for this command invocation only.
- `/whoami` shows the current endpoint, chat, and user IDs. This is useful when filling `access.allowedUserIds`.
- `/reload` sends the reply first, then exits the daemon so a supervisor can restart it and reload config from disk.
- `/restart` sends the reply first, then exits the daemon so a supervisor can restart it.

Notes:

- `/start` is treated as an alias for `/new`.
- A chat's selected agent defaults from the endpoint's `routing.defaultAgentId`. Switching agents does not rewrite an existing session; it points the chat at the selected agent's active session.
- Active sessions are agent-scoped. If one surface starts a new session for an agent, later messages to that same agent from another surface continue in that new session.
- `/reload` and `/restart` are most useful when `imp` is installed under a service manager.
- `/logs` reads the endpoint's daemon log file. If no log file exists yet, the command says so instead of inferring that the endpoint is live.
- If `endpoints[].voice.enabled` is configured, private Telegram voice messages are accepted, transcribed, echoed back as a `Transcript` message, and then processed like normal user text.
- Voice transcription uses OpenAI only and requires `OPENAI_API_KEY` in the daemon environment.
- Private Telegram document attachments from allowed users are downloaded into the active session under `attachments/`.
- Document captions become the user message text. If no caption is present, imp sends the agent a text message that explicitly says a document was uploaded.
- Document messages include explicit attachment context for the agent, including Telegram metadata and the local saved path.
- Document downloads are limited by `endpoints[].document.maxDownloadBytes`, which defaults to `20971520` bytes.
- Photos are not supported and are not treated as document or image-understanding input.

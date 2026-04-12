# Telegram Commands

Telegram endpoints register their command menu automatically on startup for each configured endpoint.

These commands are part of the built-in Telegram UX. They control sessions, diagnostics, and daemon lifecycle from chat.

Current commands:

- `/help` shows the available commands.
- `/whoami` shows the current endpoint, chat, and user IDs.
- `/new` starts a fresh session and keeps the previous session available in `/history`.
- `/start` is an alias for `/new`.
- `/rename <title>` sets a title for the active session.
- `/reset` resets the messages in the active session while preserving its title and agent.
- `/status` shows the active session details, including title, agent, message count, timestamps, working directory, and how many previous sessions are available.
- `/history` lists previous sessions and their transcript entry counts.
- `/restore <n>` switches to session `n` from `/history`.
- `/export` renders the active session transcript as plain text, including tool calls and tool results.
- `/ping` returns a simple liveness response.
- `/config` shows runtime and config details for the current endpoint, including instance name, config path, data root, logging level, enabled endpoints, and the endpoint's default agent.
- `/agent` shows the current agent details, including provider, model, base prompt, auth file, instructions, references, workspace, skills, tools, and available agent IDs.
- `/agent <id>` switches the active session to another configured agent and shows its details.
- `/logs` shows the last 20 daemon log lines for the current endpoint.
- `/logs <lines>` shows that many recent daemon log lines for the current endpoint for this command invocation only.
- `/whoami` shows the current endpoint, chat, and user IDs. This is useful when filling `access.allowedUserIds`.
- `/reload` sends the reply first, then exits the daemon so a supervisor can restart it and reload config from disk.
- `/restart` sends the reply first, then exits the daemon so a supervisor can restart it.

Notes:

- `/start` is treated as an alias for `/new`.
- `/reload` and `/restart` are most useful when `imp` is installed under a service manager.
- `/logs` reads the endpoint's daemon log file. If no log file exists yet, the command says so instead of inferring that the endpoint is live.
- If `endpoints[].voice.enabled` is configured, private Telegram voice messages are accepted, transcribed, echoed back as a `Transcript` message, and then processed like normal user text.
- Voice transcription V1 uses OpenAI only and requires `OPENAI_API_KEY` in the daemon environment.

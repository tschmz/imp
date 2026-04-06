# Telegram Commands

Telegram bots register their command menu automatically on startup for each configured bot.

Current commands:

- `/help` shows the available commands.
- `/whoami` shows the current bot, chat, and user IDs.
- `/new` starts a fresh session and keeps the previous session available in `/history`.
- `/rename <title>` sets a title for the active session.
- `/clear` clears the active session.
- `/status` shows the active session state.
- `/history` lists previous sessions.
- `/restore <n>` switches to session `n` from `/history`.
- `/export` renders the active session transcript as plain text.
- `/ping` returns a simple liveness response.
- `/config` shows the current runtime/config path details for the bot.
- `/agent` shows the current agent details, including provider, model, prompt/auth paths, context files, and available agent IDs.
- `/agent <id>` switches the active session to another configured agent and shows its details.
- `/logs` shows recent daemon log lines for the current bot.
- `/logs <lines>` changes how many recent log lines are shown.
- `/reload` sends the reply first, then exits the daemon so a supervisor can restart it and reload config from disk.
- `/restart` sends the reply first, then exits the daemon so a supervisor can restart it.

# Telegram Commands

Telegram bots register their command menu automatically on startup for each configured bot.

Current commands:

- `/help` shows the available commands.
- `/whoami` shows the current bot, chat, and user IDs.
- `/new` starts a fresh conversation and backs up the previous active conversation.
- `/rename <title>` sets a title for the current conversation.
- `/clear` clears the active conversation without creating a backup.
- `/status` shows the current conversation state.
- `/history` lists available restore points.
- `/restore <n>` restores backup `n` from `/history` and backs up the currently active conversation before overwrite.
- `/export` renders the current conversation transcript as plain text.
- `/ping` returns a simple liveness response.
- `/config` shows the current runtime/config path details for the bot.
- `/agent` shows the current agent details, including provider, model, prompt/auth paths, context files, and available agent IDs.
- `/agent <id>` switches the current conversation to another configured agent and shows its details.
- `/logs` shows recent daemon log lines for the current bot.
- `/logs <lines>` changes how many recent log lines are shown.
- `/reload` sends the reply first, then exits the daemon so a supervisor can restart it and reload config from disk.
- `/restart` sends the reply first, then exits the daemon so a supervisor can restart it.

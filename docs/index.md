# Imp Documentation

Imp is a local service for running personal AI agents. It is designed for users who want AI assistants they can reach from familiar places, such as Telegram or a local terminal, while keeping the runtime under their own control.

With Imp, you can configure multiple agents for different roles, each with its own model, instructions, workspace, and tools. A single Imp instance can route conversations to the right agent, let you switch agents when needed, and preserve separate session histories so earlier work remains available.

Imp also includes practical day-to-day controls for starting new chats, resuming previous sessions, exporting conversations, viewing logs, validating configuration, managing backups, and running the service in the background.

## Start Here

- [Getting Started](./getting-started.md): install Imp, run the initial setup, and start a local chat.
- [Configuration](./configuration.md): inspect and update the active config with the CLI.

## Customize Agents

- [Agent Context](./agent-context.md): customize the system prompt, instructions, reference files, workspace context, and skills.
- [Agent Tools](./agent-tools.md): decide which built-in tools, MCP servers, and delegated agents an agent may use.
- [Providers](./providers.md): choose a model provider and provide the required credentials.

## Connect and Operate

- [Telegram](./telegram.md): connect Imp to a private Telegram chat and use the built-in chat commands.
- [Plugins](./plugins.md): connect local companion components through file endpoints and optional MCP servers.
- [Backups](./backups.md): create and restore archives for config, agent files, and conversations.
- [Troubleshooting](./troubleshooting.md): diagnose common setup, config, endpoint, and service problems.

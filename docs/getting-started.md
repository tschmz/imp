# Getting Started

This guide gets you from a fresh machine to your first local chat. The local terminal chat is the easiest first step because it does not require Telegram or a background service.

## 1. Check Requirements

You need:

- Node.js 20.6 or newer
- npm
- Credentials for at least one model provider

For example, for OpenAI:

```sh
export OPENAI_API_KEY="your-api-key"
```

See [Providers](./providers.md) for other provider names and required variables.

## 2. Install Imp

Install the `imp` command globally:

```sh
npm install -g @tschmz/imp
```

Check that it is available:

```sh
imp --version
```

## 3. Create the First Config

Run the interactive setup:

```sh
imp init
```

The setup asks for a first agent, model provider, and optional endpoint settings. It writes a config file for the current user unless you pass `--config`.

## 4. Start a Local Chat

Start an interactive terminal chat:

```sh
imp chat
```

Send a message. When the agent replies, Imp is working.

Inside chat, use:

```text
/help
```

to see available commands such as `/status`, `/history`, `/new`, `/agent`, and `/export`.

## 5. Add Telegram or a Service Later

After the local chat works, you can:

- [Connect Telegram](./telegram.md)
- [Install a background service](./configuration.md#apply-config-changes)
- [Customize agent instructions](./agent-context.md)
- [Enable tools carefully](./agent-tools.md)
- [Create a backup](./backups.md)

## Common First Checks

If the first chat fails:

```sh
imp config validate --preflight
```

Then check [Troubleshooting](./troubleshooting.md).

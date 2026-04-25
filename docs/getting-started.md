# Getting Started

This guide takes you from installing Imp to your first local conversation. The fastest first step is the terminal chat, because it does not require Telegram or a background service.

## What You Will Set Up

You will install the `imp` command, run the interactive setup, and start a local chat session.

## Requirements

Before you start, make sure you have:

- Node.js 20.6 or newer
- npm
- Access credentials for the model provider you want to use

For example, if you choose OpenAI during setup, make sure `OPENAI_API_KEY` is available in your shell:

```sh
export OPENAI_API_KEY="your-api-key"
```

## Install Imp

Install Imp globally with npm:

```sh
npm install -g @tschmz/imp
```

Check that the command is available:

```sh
imp --version
```

## Run Initial Setup

Run the interactive setup:

```sh
imp init
```

Imp will ask a few questions about your first agent, model provider, and optional integrations.

## Start a Local Chat

Start an interactive terminal chat:

```sh
imp chat
```

Send a first message. When the agent replies, your local Imp setup is working.

Enter `/help` in the chat to view available commands.

## Next Steps

After your first local chat works, you can:

- Configure a dedicated agent for a specific role
- Connect Telegram
- Install Imp as a background service
- Learn how sessions, logs, and backups work

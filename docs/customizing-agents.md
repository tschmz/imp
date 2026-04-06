# Customizing Agents

The main customization surface in `imp` is the agent definition.

An agent combines:

- a model
- a prompt
- an optional workspace
- an optional tool set
- optional provider-specific request settings

## Prompt Structure

Each agent needs `prompt.base`.

You can define prompt content inline:

```json
{
  "base": {
    "text": "You are a concise support assistant."
  }
}
```

Or load it from a file:

```json
{
  "base": {
    "file": "./SYSTEM.md"
  }
}
```

You can then add:

- `instructions`: extra directive files or text blocks
- `references`: extra context files or text blocks

This is the main way to adapt `imp` to a project, workspace, or operating style.

## Using Workspace Files

A typical project-aware agent uses:

- `workspace.cwd` to point tools at the right directory
- `prompt.instructions` to load `AGENTS.md`
- `prompt.references` to load project-specific docs or runbooks

Example:

```json
{
  "id": "default",
  "model": {
    "provider": "openai",
    "modelId": "gpt-5.4"
  },
  "prompt": {
    "base": {
      "file": "./SYSTEM.md"
    },
    "instructions": [
      {
        "file": "/path/to/project/AGENTS.md"
      }
    ],
    "references": [
      {
        "file": "/path/to/project/RUNBOOK.md"
      }
    ]
  },
  "workspace": {
    "cwd": "/path/to/project",
    "shellPath": [
      "/usr/local/bin",
      "/usr/bin",
      "/bin"
    ]
  },
  "tools": ["read", "bash", "edit", "write", "grep", "find", "ls"]
}
```

## Choosing Tools

Tools are disabled unless you list them in `agents[].tools`.

Common tools:

- `read`
- `bash`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

Optional additional tools:

- `pwd`
- `cd`

See [Built-in tools](./tools.md) for the full reference.

## Multiple Agents

You can define several agents and route bots or conversations between them.

Common patterns:

- one default general-purpose agent
- one operations or runbook agent
- one repository-specific agent with a dedicated workspace

Global fallback:

```json
{
  "defaults": {
    "agentId": "default"
  }
}
```

Per-bot override:

```json
{
  "routing": {
    "defaultAgentId": "ops"
  }
}
```

In Telegram, users can also inspect and switch agents with `/agent`.

## Provider Credentials

Credentials depend on the configured provider.

Most providers use environment variables. Some providers also support OAuth-backed `authFile` flows.

See [Supported providers](./providers.md) for the credential reference.

## Inference Settings

`agents[].inference` passes provider-specific request settings through to the model layer.

Use this for settings such as:

- metadata
- reasoning options
- storage flags
- provider-specific request payload fields

Keep this section small unless you need explicit provider behavior.

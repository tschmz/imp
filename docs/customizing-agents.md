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

## Prompt File Templates

V1 prompt templating is intentionally narrow.

- only file-backed `prompt.instructions` and `prompt.references` are templated
- `prompt.base` is not templated
- inline `text` sources are not templated
- syntax is only `{{path.to.value}}`
- unknown variables fail immediately with the file path in the error
- documented variables with no runtime value render as an empty string
- functions, loops, conditionals, defaults, and time-based variables are not supported

Available variables:

- `system.os`
- `system.platform`
- `system.arch`
- `system.hostname`
- `system.username`
- `system.homeDir`
- `bot.id`
- `agent.id`
- `agent.model.provider`
- `agent.model.modelId`
- `agent.authFile`
- `agent.workspace.cwd`
- `transport.kind`
- `imp.configPath`
- `imp.dataRoot`

Example instruction file:

```md
Run on {{system.platform}} as {{system.username}}.
Bot: {{bot.id}}
Agent: {{agent.id}} using {{agent.model.provider}}/{{agent.model.modelId}}
Workspace: {{agent.workspace.cwd}}
Config: {{imp.configPath}}
```

## Using Workspace Files

A typical project-aware agent uses:

- `workspace.cwd` to point tools at the right directory
- `prompt.instructions` to load `AGENTS.md`
- `prompt.references` to load project-specific docs or runbooks
- `bots[].skills.paths` to expose reusable `SKILL.md` catalogs per bot

## Bot Skill Catalogs

Bots can define `skills.paths` to expose reusable skills alongside the normal agent prompt.

Rules:

- each configured path is scanned one level deep only
- only direct child directories containing `SKILL.md` are considered
- `SKILL.md` frontmatter must be valid YAML and include `name` and `description`
- invalid files and duplicate skill names are ignored for that bot
- skill discovery is logged per bot at startup
- selection uses only skill metadata and activates at most three skills per user turn
- if selection fails, no skills are activated for that turn
- the selected `SKILL.md` contents are injected into prompt context
- files under `references/` are loaded into prompt context when their skill is activated
- files under `scripts/` are exposed as local script paths for explicit inspection or execution, but are never run automatically
- activated skill names are logged per turn

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

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

Prompt files use Handlebars templating.

- file-backed `prompt.base`, `prompt.instructions`, and `prompt.references` are templated
- inline `text` sources are not templated
- syntax includes variables, `if`/`else`, `unless`, `each`, and `with`
- unknown variables fail immediately with the file path in the error
- documented variables with no runtime value render as an empty string
- arbitrary JavaScript execution, custom user-defined helpers, defaults, and time-based variables are not supported
- `instructionAttr` escapes values for XML-like instruction tag attributes

Available variables:

- `system.os`
- `system.platform`
- `system.arch`
- `system.hostname`
- `system.username`
- `system.homeDir`
- `endpoint.id`
- `agent.id`
- `agent.model.provider`
- `agent.model.modelId`
- `agent.authFile`
- `agent.workspace.cwd`
- `transport.kind`
- `imp.configPath`
- `imp.dataRoot`
- `skills`
- `skills[].name`
- `skills[].description`
- `skills[].directoryPath`

Example instruction file:

```md
Run on {{system.platform}} as {{system.username}}.
Endpoint: {{endpoint.id}}
Agent: {{agent.id}} using {{agent.model.provider}}/{{agent.model.modelId}}
Workspace: {{agent.workspace.cwd}}
Config: {{imp.configPath}}
```

## Using Workspace Files

A typical project-aware agent uses:

- `workspace.cwd` to point tools at the right directory
- `prompt.instructions` to load `AGENTS.md`
- `prompt.references` to load project-specific docs or runbooks
- `agents[].skills.paths` to expose reusable shared `SKILL.md` catalogs per agent
- `workspace.cwd` or the session's current working directory to expose workspace-local skills from `.skills`

## Agent Skill Catalogs

Agents can define `skills.paths` to expose reusable shared skills alongside the normal agent prompt.

In addition, if an agent has an explicit workspace directory, `imp` also loads skills from `<working-directory>/.skills` on each user turn. The effective working directory is the session working directory when the agent has changed it, otherwise `agent.workspace.cwd`.

Rules:

- each configured path and workspace `.skills` directory is scanned one level deep only
- only direct child directories containing `SKILL.md` are considered
- automatic workspace `.skills` loading applies only to explicit working directories; it does not fall back to the daemon process working directory
- workspace `.skills` are re-read on each turn, so changes apply without restarting `imp`
- `SKILL.md` frontmatter must be valid YAML and include `name` and `description`
- invalid files are ignored for that agent or turn and logged for diagnostics
- duplicate skill names across configured `skills.paths` are ignored for that agent
- when a workspace skill name collides with a configured agent skill, the workspace skill overrides the configured one for that turn
- skill discovery for configured paths is logged per agent at startup
- all available skills are exposed to prompt file templates as metadata only: skill directory path, skill name, and description
- when available skills exist, the `load_skill` tool is enabled automatically for that turn
- `load_skill` returns the selected skill's `SKILL.md` content and files under `references/`
- `load_skill` does not return script contents; scripts can be documented from `SKILL.md` and inspected through normal filesystem tools if needed

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

You can define several agents and route endpoints or conversations between them.

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

Per-endpoint override:

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

# Customizing Agents

The main customization surface in `imp` is the agent definition.

An agent combines:

- a model
- a prompt
- an optional home directory
- an optional workspace
- an optional tool set
- optional provider-specific request settings

Model configs can also override built-in model metadata, or define a fully custom model for an OpenAI-compatible local endpoint such as LM Studio. For a custom model, set `model.api`, `model.baseUrl`, `model.reasoning`, `model.input`, `model.contextWindow`, and `model.maxTokens` alongside `model.provider` and `model.modelId`.

Example:

```json
{
  "id": "local-lms",
  "model": {
    "provider": "openai",
    "modelId": "qwen/qwen3-coder-next",
    "api": "openai-responses",
    "baseUrl": "http://pc:1234/v1",
    "reasoning": false,
    "input": ["text"],
    "contextWindow": 262144,
    "maxTokens": 32768
  }
}
```

## Prompt Structure

Agents use the built-in default system prompt when `prompt.base` is omitted. Configure `prompt.base` only when you want to replace that default.

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

Each agent also has a home directory. It defaults to `paths.dataRoot/agents/<agent-id>`, or you can set `home` explicitly on the agent. On each turn, `imp` loads every direct `*.md` file in the agent home alphabetically as separate instruction blocks before explicit `prompt.instructions`; it then loads the workspace `AGENTS.md` when available.

## Prompt File Templates

Prompt files use Handlebars templating.

- file-backed `prompt.base`, `prompt.instructions`, and `prompt.references` are templated
- inline `text` sources are not templated
- syntax includes variables, `if`/`else`, `unless`, `each`, `with`, and `eq`
- unknown variables fail immediately with the file path in the error
- documented variables with no runtime value render as an empty string
- arbitrary JavaScript execution, custom user-defined helpers, and defaults are not supported
- second-precision runtime clock values such as `runtime.now.iso`, `runtime.now.time`, and `runtime.now.local` are not cached
- minute-precision values such as `runtime.now.timeMinute` and `runtime.now.localMinute` are cached per minute
- `instructionAttr` escapes values for XML-like instruction tag attributes
- `instructionText` escapes values for XML-like instruction tag text

Available variables:

- `system.os`
- `system.platform`
- `system.arch`
- `system.hostname`
- `system.username`
- `system.homeDir`
- `runtime.now.iso`
- `runtime.now.date`
- `runtime.now.time`
- `runtime.now.timeMinute`
- `runtime.now.local`
- `runtime.now.localMinute`
- `runtime.timezone`
- `endpoint.id`
- `agent.id`
- `agent.home`
- `agent.model.provider`
- `agent.model.modelId`
- `agent.authFile`
- `agent.workspace.cwd`
- `transport.kind`
- `conversation.kind`
- `conversation.metadata`
- `reply.channel.kind`
- `reply.channel.delivery`
- `reply.channel.endpointId`
- `imp.configPath`
- `imp.dataRoot`
- `skills`
- `skills[].name`
- `skills[].description`
- `skills[].directoryPath`
- `skills[].filePath`

Example instruction file:

```md
Run on {{system.platform}} as {{system.username}}.
Endpoint: {{endpoint.id}}
Agent: {{agent.id}} using {{agent.model.provider}}/{{agent.model.modelId}}
Workspace: {{agent.workspace.cwd}}
Config: {{imp.configPath}}
Reply channel: {{reply.channel.kind}}
```

Use `reply.channel.kind` for channel-specific prompt behavior. For example, a prompt file can use `{{#if (eq reply.channel.kind "audio")}}` for spoken replies and `{{#if (eq reply.channel.kind "telegram")}}` for Telegram formatting. Keep those decisions in prompt files; the daemon exposes the context but does not inject hidden channel instructions.

## Using Workspace Files

A typical project-aware agent uses:

- `workspace.cwd` to point tools at the right directory
- `prompt.instructions` to load `AGENTS.md`
- `prompt.references` to load project-specific docs or runbooks
- `paths.dataRoot/skills` to expose shared auto-discovered skills
- `agents[].skills.paths` to expose explicitly configured shared `SKILL.md` catalogs per agent
- `agent.home/.skills` to expose agent-specific auto-discovered skills
- `workspace.cwd` or the session's current working directory to expose workspace-local skills from `.skills`

## Agent Skill Catalogs

Agents can define `skills.paths` to expose reusable shared skills alongside the normal agent prompt.

In addition, `imp` auto-discovers skills on each user turn from `paths.dataRoot/skills`, `agent.home/.skills`, and `<working-directory>/.skills`. The effective working directory is the session working directory when the agent has changed it, otherwise `agent.workspace.cwd`.

Skill catalogs are merged in this order:

1. `paths.dataRoot/skills`
2. `agent.home/.skills`
3. configured `agents[].skills.paths`
4. `<working-directory>/.skills`

Later entries override earlier entries with the same skill name.

Rules:

- each configured path, `paths.dataRoot/skills`, `agent.home/.skills`, and workspace `.skills` directory is scanned one level deep only
- only direct child directories containing `SKILL.md` are considered
- automatic workspace `.skills` loading applies only to explicit working directories; it does not fall back to the daemon process working directory
- auto-discovered skill directories are re-read on each turn, so changes apply without restarting `imp`
- `SKILL.md` frontmatter must be valid YAML and include `name` and `description`
- invalid files are ignored for that agent or turn and logged for diagnostics
- duplicate skill names within one discovery source are ignored for that agent or turn
- when an auto-discovered skill name collides with an earlier skill, the later source overrides the earlier one for that turn
- configured base prompt source, skill catalogs, instruction files, and reference files are logged per agent at startup
- all available skills are exposed to prompt file templates as metadata only: skill directory path, `SKILL.md` path, skill name, and description
- when available skills exist, the `load_skill` tool is enabled automatically for that turn
- `load_skill` returns the selected skill's `SKILL.md` instructions, the absolute skill directory, and a `<skill_resources>` list of bundled `scripts/` and `references/` files
- `load_skill` does not return bundled resource contents; scripts and references can be documented from `SKILL.md` and inspected through normal filesystem tools when needed

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
- `phone_call`

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

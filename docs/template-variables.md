# Template Variables

Imp renders prompt templates with Handlebars. Templates are supported in:

- `prompt.base.text` and `prompt.base.file`
- `prompt.instructions[].text` and `prompt.instructions[].file`
- `prompt.references[].text` and `prompt.references[].file`
- skill `SKILL.md` bodies when loaded through `load_skill`

Unknown variables or unsupported helpers fail prompt rendering. Known variables that have no value for the current turn render as empty strings.

## Common Examples

```md
You are {{agent.name}}.
Model: {{agent.model.provider}}/{{agent.model.modelId}}
{{#if agent.workspace.cwd}}Workspace: {{agent.workspace.cwd}}{{/if}}

{{#if skills.length}}
Available skills:
{{#each skills}}
- {{name}}: {{description}}
{{/each}}
{{/if}}

{{promptSections "INSTRUCTIONS" prompt.instructions}}
{{promptSections "REFERENCE" prompt.references}}
```

Rendered values might look like:

```md
You are Default.
Model: openai/gpt-5.5
Workspace: /home/thomas/Workspace/imp

Available skills:
- commit: Use this skill when creating commits in this repository; enforce the repository commit message format.
```

## Variables

### `system`

Host information from Node.js and the current process.

| Variable | Description | Example |
| --- | --- | --- |
| `system.os` | Operating system name from Node `os.type()`. | `Linux` |
| `system.platform` | Node platform ID. | `linux` |
| `system.arch` | CPU architecture. | `x64` |
| `system.hostname` | Hostname. | `workstation` |
| `system.username` | Current OS user. | `thomas` |
| `system.homeDir` | Current OS home directory. | `/home/thomas` |

Example:

```md
Running on {{system.platform}}/{{system.arch}} as {{system.username}}.
```

### `runtime`

Current time information for the prompt render.

| Variable | Description | Example |
| --- | --- | --- |
| `runtime.timezone` | Time zone used for local time formatting. | `Europe/Berlin` |
| `runtime.now.iso` | Current instant as ISO string. | `2026-05-03T19:35:01.123Z` |
| `runtime.now.date` | Local date. | `2026-05-03` |
| `runtime.now.time` | Local time with seconds. | `21:35:01` |
| `runtime.now.timeMinute` | Local time without seconds. | `21:35` |
| `runtime.now.local` | Local date, time, and time zone. | `2026-05-03 21:35:01 Europe/Berlin` |
| `runtime.now.localMinute` | Local date, minute, and time zone. | `2026-05-03 21:35 Europe/Berlin` |

Example:

```md
Today is {{runtime.now.date}} in {{runtime.timezone}}.
```

Prompts that use `runtime.now.iso` or `runtime.now.time` are not cached across turns. Minute-precision and date-only values use coarser cache keys.

### `invocation`

How the agent was invoked for the current run.

| Variable | Description | Example |
| --- | --- | --- |
| `invocation.kind` | Invocation type. | `direct` or `delegated` |
| `invocation.parentAgentId` | Parent agent ID for delegated runs, empty otherwise. | `default` |
| `invocation.toolName` | Delegation tool name for delegated runs, empty otherwise. | `ask_ops` |

Example:

```md
{{#if (eq invocation.kind "delegated")}}Return only the result needed by {{invocation.parentAgentId}}.{{/if}}
```

### `ingress`, `endpoint`, and `transport`

Where the current user message entered Imp. `endpoint` and `transport` are short aliases for the same ingress values.

| Variable | Description | Example |
| --- | --- | --- |
| `ingress.endpoint.id` | Endpoint ID that received the message. | `private-telegram` |
| `endpoint.id` | Alias for `ingress.endpoint.id`. | `private-telegram` |
| `ingress.transport.kind` | Transport type that received the message. | `telegram` |
| `transport.kind` | Alias for `ingress.transport.kind`. | `telegram` |

Example:

```md
Request arrived through {{transport.kind}} endpoint {{endpoint.id}}.
```

### `output` and `reply`

How the final response should be delivered. `reply.channel` is a short alias for `output.reply.channel`.

| Variable | Description | Example |
| --- | --- | --- |
| `output.mode` | Output mode for the run. | `reply-channel` or `delegated-tool` |
| `output.reply.channel.kind` | Reply channel kind. | `telegram`, `cli`, `audio`, or `none` |
| `reply.channel.kind` | Alias for `output.reply.channel.kind`. | `telegram` |
| `output.reply.channel.delivery` | Delivery mechanism. | `endpoint`, `outbox`, or `none` |
| `reply.channel.delivery` | Alias for `output.reply.channel.delivery`. | `endpoint` |
| `output.reply.channel.endpointId` | Target endpoint ID when available. | `private-telegram` |
| `reply.channel.endpointId` | Alias for `output.reply.channel.endpointId`. | `private-telegram` |

Example:

```md
{{#if (eq reply.channel.kind "audio")}}Write plain spoken text without Markdown.{{/if}}
```

### `agent`

The resolved agent definition for the current run.

| Variable | Description | Example |
| --- | --- | --- |
| `agent.id` | Agent ID. | `default` |
| `agent.name` | Display name. | `Default` |
| `agent.home` | Agent home directory, or empty if unset. | `/var/lib/imp/agents/default` |
| `agent.model.provider` | Model provider ID. | `openai` |
| `agent.model.modelId` | Model ID. | `gpt-5.5` |
| `agent.model.authFile` | Resolved OAuth/auth file path, or empty if unset. | `/var/lib/imp/auth.json` |
| `agent.workspace.cwd` | Agent workspace directory, or empty if unset. | `/home/thomas/Workspace/imp` |

Example:

```md
You are {{agent.name}}.
{{#if agent.home}}Agent home: {{agent.home}}{{/if}}
```

### `conversation`

Current conversation metadata.

| Variable | Description | Example |
| --- | --- | --- |
| `conversation.kind` | Optional conversation kind from stored state, or empty. | `chat` |
| `conversation.metadata` | Metadata object from stored conversation state. | `{"customerId":"acme"}` |

Use `with` for metadata objects when you know their shape:

```md
{{#with conversation.metadata}}
Customer: {{customerId}}
{{/with}}
```

### `imp`

Imp runtime paths and skill catalog locations.

| Variable | Description | Example |
| --- | --- | --- |
| `imp.configPath` | Active config file path, or empty if unavailable. | `/etc/imp/config.json` |
| `imp.dataRoot` | Runtime data root, or empty if unavailable. | `/var/lib/imp` |
| `imp.dynamicWorkspaceSkillsPath` | Skill catalog path for the active workspace, or empty if no workspace is active. | `/home/thomas/Workspace/imp/.agents/skills` |
| `imp.skillCatalogs` | Ordered list of skill catalog locations Imp considers for the turn. | See below |

Each `imp.skillCatalogs` item has:

| Variable | Description | Example |
| --- | --- | --- |
| `label` | Human-readable catalog label. | `workspace agent catalog for default` |
| `path` | Filesystem path for that catalog. | `/home/thomas/Workspace/imp/.agents/skills` |

Example:

```md
Skill catalogs:
{{#each imp.skillCatalogs}}
- {{label}}: {{path}}
{{/each}}
```

Rendered values might look like:

```md
Skill catalogs:
- global shared catalog: /var/lib/imp/skills
- user shared catalog: /home/thomas/.agents/skills
- agent-home catalog for default: /var/lib/imp/agents/default/.skills
- workspace agent catalog for default: /home/thomas/Workspace/imp/.agents/skills
```

### `prompt`

Resolved instruction and reference sections. These arrays are populated when the base prompt is rendered. They are empty while instruction files, reference files, and loaded skill bodies are rendered.

| Variable | Description | Example |
| --- | --- | --- |
| `prompt.instructions` | Resolved instruction sections. | See below |
| `prompt.references` | Resolved reference sections. | See below |

Each `prompt.instructions` and `prompt.references` item has:

| Variable | Description | Example |
| --- | --- | --- |
| `source` | Source label for the section. | `/workspace/AGENTS.md` or `inline` |
| `content` | Rendered section content. | `Use npm run check before committing.` |

Use `promptSections` unless you need custom formatting:

```md
{{promptSections "INSTRUCTIONS" prompt.instructions}}
{{promptSections "REFERENCE" prompt.references}}
```

Rendered values look like:

```md
<INSTRUCTIONS from="/workspace/AGENTS.md">

Use npm run check before committing.
</INSTRUCTIONS>
```

If a custom base prompt omits these helpers, configured instructions and references are not included.

### `skills`

Skill metadata available for the current turn. The list includes only names, descriptions, and paths. Full skill instructions are loaded later through `load_skill`.

| Variable | Description | Example |
| --- | --- | --- |
| `skills` | Array of available skill metadata. | See below |

Each `skills` item has:

| Variable | Description | Example |
| --- | --- | --- |
| `name` | Exact skill name. | `commit` |
| `description` | Short skill description. | `Use this skill when creating commits in this repository; enforce the repository commit message format.` |
| `directoryPath` | Skill directory. | `/home/thomas/Workspace/imp/.agents/skills/commit` |
| `filePath` | Skill manifest path. | `/home/thomas/Workspace/imp/.agents/skills/commit/SKILL.md` |

Example:

```md
{{#if skills.length}}
Available skills:
{{#each skills}}
- {{name}}: {{description}} ({{filePath}})
{{/each}}
{{/if}}
```

Rendered values might look like:

```md
Available skills:
- commit: Use this skill when creating commits in this repository; enforce the repository commit message format. (/home/thomas/Workspace/imp/.agents/skills/commit/SKILL.md)
```

## Helpers

Imp allows a small set of Handlebars helpers.

| Helper | Description | Example |
| --- | --- | --- |
| `if` | Render a block when a value is truthy. | `{{#if agent.home}}...{{/if}}` |
| `unless` | Render a block when a value is falsy. | `{{#unless skills.length}}No skills.{{/unless}}` |
| `each` | Iterate arrays. | `{{#each skills}}{{name}}{{/each}}` |
| `with` | Change the current object context. | `{{#with conversation.metadata}}{{customerId}}{{/with}}` |
| `eq` | Compare two values for strict equality. | `{{#if (eq reply.channel.kind "audio")}}...{{/if}}` |
| `promptSections` | Render instruction or reference arrays as escaped XML-like sections. | `{{promptSections "INSTRUCTIONS" prompt.instructions}}` |
| `instructionText` | Escape text for instruction-style XML content. | `{{instructionText description}}` |
| `instructionAttr` | Escape text for instruction-style XML attributes. | `<x from="{{instructionAttr source}}">` |

`promptSections`, `instructionText`, and `instructionAttr` escape `&`, `<`, and `>` so user-authored prompt content cannot accidentally break the surrounding section markup.

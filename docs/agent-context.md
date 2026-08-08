# Agent Context

Agent context is the information Imp gives an agent before it answers. Use it to describe the agent's role, add operating instructions, provide reference material, choose a workspace, and make reusable skills available.

The examples use `agents.default` for the agent with ID `default`.

## What to Customize First

For most users, start with these settings:

1. `prompt.instructions`: short rules for how the agent should behave.
2. `prompt.references`: background material the agent should know about.
3. `workspace.cwd`: the folder the agent should treat as its working area.
4. `skills.paths`: reusable workflows the agent can load when needed.

You usually do not need to replace the full base system prompt.

## Instructions

Instructions are behavior rules. They are appended to the agent's system prompt.

Set one inline instruction:

```sh
imp config set agents.default.prompt.instructions '[{"text":"Answer concisely and ask before making destructive changes."}]'
```

Use instruction files when rules become longer:

```sh
imp config set agents.default.prompt.instructions '[{"file":"./agents/default/AGENTS.md"},{"file":"./agents/default/WORKFLOW.md"}]'
```

Good instruction files contain role definitions, preferred workflows, project rules, coding standards, support procedures, or personal preferences.

## Reference Context

References are background information. They are useful for runbooks, product notes, project overviews, policies, or domain notes.

```sh
imp config set agents.default.prompt.references '[{"file":"./agents/default/RUNBOOK.md"}]'
```

Inline reference text also works:

```sh
imp config set agents.default.prompt.references '[{"text":"Use the public support inbox for customer-facing escalations."}]'
```

Use instructions for rules. Use references for facts.

## Agent Home

Each agent has a home directory. Imp can load Markdown files from this directory as instruction blocks and can discover skills under `.skills`.

Set an agent home:

```sh
imp config set agents.default.home ./agents/default
```

Agent-home skills live here:

```text
./agents/default/.skills
```

Keep base prompt files in a subdirectory such as `prompts/`. If you place `SYSTEM.md` directly in the agent home and also configure it as `prompt.base.file`, Imp may use it both as a base prompt and as an instruction file.

## Workspace Context

A workspace points an agent at a working directory. It affects file-oriented context and the default location for file and shell tools.

```sh
imp config set agents.default.workspace.cwd /path/to/project
```

If the active working directory contains `AGENTS.md`, Imp loads it as an instruction file for the turn.

Workspace-local skills live here:

```text
/path/to/project/.agents/skills
```

If shell tools need extra command locations, set `workspace.shellPath`:

```sh
imp config set agents.default.workspace '{"cwd":"/path/to/project","shellPath":["/usr/local/bin","/usr/bin","/bin"]}'
```

## Skills

Skills are reusable workflow packages. A skill is a directory with `SKILL.md` and optional bundled resources.

Set shared skill catalogs:

```sh
imp config set agents.default.skills.paths '["./skills"]'
```

Imp can make skills available from:

- The shared data-root skill catalog
- The user shared `~/.agents/skills` catalog
- The agent-home `.skills` directory
- Configured `agents.<id>.skills.paths` catalogs
- The active workspace `.agents/skills` directory

The agent sees skill names and descriptions. Full skill instructions are loaded only when the agent decides to use a skill.

## Base System Prompt

`prompt.base` replaces the built-in system prompt. Replace it only when you want full control over the prompt template.

Use a file-backed base prompt:

```sh
imp config set agents.default.prompt.base '{"file":"./agents/default/prompts/SYSTEM.md"}'
```

Or use a short inline base prompt:

```sh
imp config set agents.default.prompt.base '{"text":"You are a concise personal research assistant."}'
```

Custom prompt files can use template variables such as:

```md
You are {{agent.id}}, an assistant running through Imp.

Reply channel: {{reply.channel.kind}}
{{#if agent.workspace.cwd}}Workspace: {{agent.workspace.cwd}}{{/if}}

{{promptSections "INSTRUCTIONS" prompt.instructions}}
{{promptSections "REFERENCE" prompt.references}}
```

If you omit `{{promptSections "INSTRUCTIONS" prompt.instructions}}`, configured instructions are not included by that custom base prompt. The same applies to references.

See [Template Variables](./template-variables.md) for the full list of prompt and skill template variables.

The built-in default prompt is stored in [`assets/agents/default-system-prompt.md`](../assets/agents/default-system-prompt.md) if you want to copy and adapt it.

## Context Loading Order

For the default base prompt, Imp assembles context in this order:

1. Built-in base prompt
2. Runtime details such as agent, model, endpoint, reply channel, and workspace
3. Available skill metadata
4. Agent-home Markdown files
5. Configured `prompt.instructions`
6. Workspace `AGENTS.md`
7. Configured `prompt.references`

## Agent Cron Jobs

Agents can maintain scheduled jobs in `cron.md` in their agent home. Imp watches this file at runtime and reloads changes without a daemon restart. `cron.md` is intentionally excluded from automatic agent-home Markdown prompt loading, so scheduled instructions are only passed to the agent when the job fires.

Each job is a Markdown section with a JSON fence tagged `json imp-cron`; the Markdown body after the fence is the scheduled user instruction sent to the agent. This instruction is not a replacement system prompt. Write only the recurring task the future run should execute, plus any run-specific context it needs. Do not repeat the agent's persona, standing rules, tool policy, or reply-routing instructions; Imp applies the agent's normal context when the job fires.

The Markdown instruction, `session.id`, and `session.title` support the same Handlebars template variables as prompt files, including `runtime.now.*`, `agent.*`, `conversation.metadata.*`, and `reply.channel.*`.

````md
# Imp Cron

## wohnungssuche

```json imp-cron
{
  "id": "wohnungssuche",
  "enabled": true,
  "schedule": "0 8 * * *",
  "timezone": "Europe/Berlin",
  "reply": {
    "type": "endpoint",
    "endpointId": "private-telegram",
    "target": {
      "conversationId": "123456789"
    }
  },
  "session": {
    "title": "Wohnungssuche"
  }
}
```

Suche nach neuen Wohnungen für {{runtime.now.date}} und fasse relevante Änderungen zusammen.
````

Set `reply.type` to `none` to run a scheduled job without response delivery.

### Schedule Syntax

Imp accepts exactly five cron fields:

```text
minute hour day-of-month month day-of-week
```

Seconds and predefined aliases such as `@daily` are not supported.

Use the optional `timezone` field with an IANA timezone such as `Europe/Berlin` to control which local time the schedule uses. If omitted, Imp uses the runtime system timezone, falling back to UTC.

| Field | Values |
| --- | --- |
| `minute` | `0-59` |
| `hour` | `0-23` |
| `day-of-month` | `1-31` |
| `month` | `1-12` or `JAN-DEC` |
| `day-of-week` | `0-7` or `SUN-SAT`; `0` and `7` are Sunday, `1` is Monday |

Fields support `*` for any value, comma-separated lists such as `1,3,5`, ranges such as `1-5`, and steps such as `*/15` or `8-18/2`. Named months and weekdays are accepted. `H` can be used for a stable hashed value, for example `H 8 * * *` to spread daily jobs across a stable minute within the 08:00 hour.

When both `day-of-month` and `day-of-week` are restricted, a run matches either field. For example, `0 8 15 * 1` runs at 08:00 on the 15th of the month and on Mondays.

Common examples:

| Schedule | Meaning |
| --- | --- |
| `5 0 * * 1` | Every Monday at 00:05 |
| `0 8 * * *` | Every day at 08:00 |
| `*/15 8-18 * * 1-5` | Every 15 minutes between 08:00 and 18:59, Monday through Friday |
| `0 0 1 * *` | At midnight on the first day of every month |
| `H 8 * * *` | Once per day during the 08:00 hour, with a stable hashed minute |

Set `session.title` to control the visible title used when a cron job creates or activates a session. If omitted, Imp uses the cron job `id` as the title.

`session.mode` defaults to `attached`, which runs the job in the agent's current active session. Use `session.mode: "detached"` to keep the cron session separate, or `session.mode: "activate"` to create/reuse the named cron session and make it the current interactive session for the agent. The previous active session remains stored; only the active pointer moves.

For `detached` and `activate`, set `session.id` to the named cron session. Use a templated `session.id`, for example `report-{{runtime.now.date}}`, when a recurring job should rotate into a fresh session each day. For `attached`, `session.id` is only a cron reference before Imp resolves the active session and can usually be omitted.

## Complete Example

```sh
imp config set agents.default.home ./agents/default
imp config set agents.default.prompt.instructions '[{"file":"./agents/default/AGENTS.md"}]'
imp config set agents.default.prompt.references '[{"file":"./agents/default/RUNBOOK.md"}]'
imp config set agents.default.workspace.cwd /path/to/project
imp config set agents.default.skills.paths '["./skills"]'
imp config validate --preflight
imp config reload
```

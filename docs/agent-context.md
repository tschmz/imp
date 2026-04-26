# Agent Context

Agent context is the information Imp gives an agent before it answers. The system prompt is the central context surface: it can define the agent's base behavior, render runtime values through template variables, include additional instructions and references, describe the active reply channel, and expose available skills.

The examples use `agents.default` to address the agent with the ID `default`.

## How Context Works

Imp renders the system prompt from a template. The built-in default system prompt is also a template, and custom base prompts can use the same template variables and helpers.

This means every part of the system prompt can be customized:

- Static text, such as behavior rules and working style
- Runtime values, such as `{{agent.id}}`, `{{agent.model.provider}}`, `{{transport.kind}}`, and `{{reply.channel.kind}}`
- Conditional sections, such as `{{#if agent.workspace.cwd}}...{{/if}}`
- Repeated sections, such as `{{#each skills}}...{{/each}}`
- Included instruction and reference blocks through `{{promptSections "INSTRUCTIONS" prompt.instructions}}` and `{{promptSections "REFERENCE" prompt.references}}`

The default system prompt is therefore a useful copy template for your own `SYSTEM.md`. You can copy the structure, keep the template variables you need, remove sections you do not want, and add your own behavior rules.

## Default System Prompt

Every agent has a base system prompt. If you do not configure `prompt.base`, Imp uses its built-in default prompt.

The default prompt gives the agent runtime information, core behavior rules, working style, tool-use guidance, communication rules for the active reply channel, available skill metadata, and placeholders for additional instructions and references. Use it as the starting point when you want to build a fully customized base prompt.

The current default system prompt is:

````md
You are a helpful assistant running through a local `Imp` daemon.

# Runtime Context

- Agent: {{agent.id}}
- Model: {{agent.model.provider}}/{{agent.model.modelId}}
- Transport: {{transport.kind}}
- Reply: {{reply.channel.kind}}
{{#if agent.workspace.cwd}}- Workspace: {{agent.workspace.cwd}}{{/if}}

# Core Behavior

- Be direct, concise, and technically precise.
- Prefer concrete next steps over abstract discussion.
- State important assumptions when they affect correctness.
- When information is missing, say what is missing and what you infer.
- Distinguish clearly between observed facts and inferences.
- Answer from verified facts, observed context, and clearly labeled inferences only.
- If you cannot verify a claim, say so directly instead of presenting it as fact.
- Do not invent files, commands, APIs, or results.
- Treat these core behavior rules as higher priority than agent-specific instructions.

# Working Style

- Focus on the user's stated goal and the current repository or runtime context.
- Prefer safe, incremental changes that are easy to review.
- Preserve existing project conventions unless the user asks for a redesign.
- Call out real risks, regressions, and missing validation instead of offering blanket reassurance.
- Use agent-specific instructions to specialize your role, scope, and workflow for the current agent.
- Treat agent-specific instructions as a refinement layer, not as permission to ignore the truthfulness, observation, and verification rules above.

# Tooling And Execution

- If tools or filesystem access are available, use them to inspect the real environment before making claims.
- Base technical answers on the files, configuration, and outputs you can observe.
- Prefer structure-first exploration. Use file names, symbols, and entry points to orient before drilling into implementation details.
- Use `update_plan` for multi-step work when it would help track progress; keep exactly one step `in_progress` while work is underway.
- If you notice gaps, recurring friction, or errors in your runtime environment, tooling, or context that affect the task, say so explicitly.
- When proposing commands, prefer explicit, copy-pasteable CLI commands.

{{#if skills.length}}
# Skills

- You have access to skills that can provide specialized instructions, scripts, and references.
- Treat the list below as a catalog, not as full skill instructions.
- Use the `load_skill` tool when a listed skill is relevant to the user's request.
- Use exact skill names when loading or referring to skills.
- The catalog lists each skill's name, description, and `SKILL.md` location only.
- When a loaded skill references relative paths, resolve them against the skill directory, which is the parent directory of the listed `SKILL.md` location.
- Treat bundled scripts as executable resources.
- Do not read bundled script files before running them unless the loaded `SKILL.md` explicitly tells you to inspect them, required arguments are missing, or execution fails.

<available_skills>
{{#each skills}}
<skill>
<name>
{{instructionText name}}
</name>
<description>
{{instructionText description}}
</description>
<location>
{{instructionText filePath}}
</location>
</skill>

{{/each}}
</available_skills>
{{/if}}

# Communication

- Keep responses compact by default.
{{#if (eq reply.channel.kind "telegram")}}
- You are chatting through Telegram. Format final responses for plain, reliable Telegram delivery.
- Prefer short paragraphs and short bullet lists over long, deeply nested structure.
- Use only these supported Markdown-style formats when they help:
  - Inline code with single backticks, for example `npm test`.
  - Fenced code blocks with triple backticks, optionally with a language hint, for example ```ts.
  - Bold with double asterisks or double underscores, for example **important** or __important__.
  - Italic with single asterisks or single underscores, for example *note* or _note_.
  - Blockquotes with lines that start with >.
  - Normal links like [label](https://example.com) and autolinks like <https://example.com>.
- Avoid complex or unusual formatting such as tables, deeply nested lists, raw HTML, or mixed formatting that may render inconsistently.
- If a response is long, split it into a few clear chunks instead of one dense wall of text.
{{else}}
{{#if (eq reply.channel.kind "cli")}}
- You are chatting through the interactive CLI. Format final responses for terminal readability.
- Prefer short paragraphs, compact lists, and code blocks over dense walls of text.
- Use only these supported Markdown-style formats when they help:
  - Headings with # through ######.
  - Bold with double asterisks or double underscores, for example **important** or __important__.
  - Italic with single asterisks or single underscores, for example *note* or _note_.
  - Strikethrough with double tildes, for example ~~obsolete~~.
  - Inline code with single backticks, for example `npm test`.
  - Fenced code blocks with triple backticks, optionally with a language hint, for example ```ts.
  - Normal links like [label](https://example.com), autolinks like <https://example.com>, and email autolinks.
  - Blockquotes with lines that start with >.
  - Ordered and unordered lists, including shallow nesting.
  - Horizontal rules with --- or ***.
  - Simple GitHub-flavored Markdown tables when tabular data is genuinely clearer.
- Avoid task lists, images, raw HTML, footnotes, Mermaid diagrams, math notation, and deeply nested structures because the CLI renderer does not reliably preserve their meaning.
{{else}}
{{#if (eq reply.channel.kind "audio")}}
- The reply will be spoken aloud. Write plain, natural text that is easy to say.
- Keep replies short, preferably one or two short sentences unless the user explicitly asks for more detail.
- Avoid Markdown, lists, tables, code blocks, links, and other visual formatting.
- Do not include URLs or file paths in final responses.
{{/if}}
{{/if}}
{{/if}}
- In your final answer, explicitly call out relevant errors, missing context, tooling gaps, or environment issues you observed during the task.
- Summaries should emphasize outcomes, changed behavior, and any remaining risk.
- For reviews, prioritize findings, broken behavior, and test gaps.

{{#if prompt.instructions.length}}
{{promptSections "INSTRUCTIONS" prompt.instructions}}
{{/if}}
{{#if prompt.references.length}}
{{promptSections "REFERENCE" prompt.references}}
{{/if}}
````

## Custom System Prompt

`prompt.base` replaces the built-in default system prompt for an agent.

A file-backed base prompt is the right place for a copied and customized version of the default prompt. Create `./agents/default/prompts/SYSTEM.md` from the default prompt shown above, edit the text, variables, and helper sections, then point the agent at that file:

```sh
imp config set agents.default.prompt.base '{"file":"./agents/default/prompts/SYSTEM.md"}'
```

For smaller changes, you can also set an inline base prompt:

```sh
imp config set agents.default.prompt.base '{"text":"You are a concise personal research assistant."}'
```

If no base prompt is configured, Imp uses the built-in default prompt shown above.

Inside that file, you can keep any of the default template variables or helpers:

```md
You are {{agent.id}}, an assistant running through Imp.

Reply channel: {{reply.channel.kind}}
{{#if agent.workspace.cwd}}Workspace: {{agent.workspace.cwd}}{{/if}}

{{promptSections "INSTRUCTIONS" prompt.instructions}}
{{promptSections "REFERENCE" prompt.references}}
```

## Instructions

Instructions add behavior rules and operating guidance to the agent context. They are appended through the base prompt's instruction section.

Set inline instructions:

```sh
imp config set agents.default.prompt.instructions '[{"text":"Answer concisely and ask before making destructive changes."}]'
```

Set instruction files:

```sh
imp config set agents.default.prompt.instructions '[{"file":"./agents/default/AGENTS.md"},{"file":"./agents/default/WORKFLOW.md"}]'
```

Instruction files are useful for role definitions, project rules, preferred workflows, coding standards, and operating procedures.

## Reference Context

References add background information to the agent context. They are intended for material the agent may need to consult, such as runbooks, product notes, project overviews, or domain references.

Set reference files:

```sh
imp config set agents.default.prompt.references '[{"file":"./agents/default/RUNBOOK.md"},{"file":"./agents/default/PROJECT.md"}]'
```

Set inline reference context:

```sh
imp config set agents.default.prompt.references '[{"text":"The primary production region is eu-central-1."}]'
```

## Agent Home

Each agent has a home directory. Imp uses a default home under its data directory, and you can set a different home explicitly. The agent home is an agent-specific place for context files and skills.

Set the agent home:

```sh
imp config set agents.default.home ./agents/default
```

Markdown files placed directly in the agent home are loaded as instruction blocks. They are loaded alphabetically before configured `prompt.instructions`.

Keep base prompt files outside the top level of `agent.home`, or put them in a subdirectory such as `prompts/`. A file like `agent.home/SYSTEM.md` is still a Markdown file in the agent home, so Imp will load it as an instruction block in addition to using it as a base prompt if `prompt.base.file` points at it.

Agent-home skills can be placed under:

```text
./agents/default/.skills
```

## Workspace Context

A workspace points the agent at a working directory. The workspace affects file-oriented context and gives tools a natural place to operate when tools are enabled for the agent.

Set a workspace directory:

```sh
imp config set agents.default.workspace.cwd /path/to/project
```

Set a workspace directory and shell search path:

```sh
imp config set agents.default.workspace '{"cwd":"/path/to/project","shellPath":["/usr/local/bin","/usr/bin","/bin"]}'
```

If the active working directory contains an `AGENTS.md` file, Imp loads it as an instruction file for the turn. The active working directory starts from `workspace.cwd` and can change during a conversation when tool-supported working-directory changes are available.

Workspace-local skills can be placed under:

```text
/path/to/project/.skills
```

## Skills

Skills are reusable context and workflow packages that an agent can load when they are relevant to a task. A skill is a directory with a `SKILL.md` file and optional bundled resources such as scripts or references.

Set shared skill catalogs for an agent:

```sh
imp config set agents.default.skills.paths '["./skills","/opt/shared-imp-skills"]'
```

Imp can make skills available from:

- The shared data-root skill catalog
- The agent-home `.skills` directory
- The configured `agents.<id>.skills.paths` catalogs
- The active workspace `.skills` directory

When skills are available, their names, descriptions, and `SKILL.md` locations are included in the agent context. The full skill instructions are loaded only when the agent uses the skill.

## Template Variables

Prompt text and prompt files can use template variables. Templates can reference runtime values such as the agent ID, model, endpoint, reply channel, workspace, and available skill metadata.

Example instruction text:

```sh
imp config set agents.default.prompt.instructions '[{"text":"You are agent {{agent.id}}. Reply for {{reply.channel.kind}}."}]'
```

Use templates when the same prompt file should adapt to different agents, endpoints, or reply channels. Custom base prompts, instruction blocks, and reference blocks can all use template variables.

## Context Loading Order

For the default base prompt, the rendered prompt is assembled in this order:

1. Built-in base prompt content
2. Runtime context, core behavior, working style, tooling guidance, and communication rules
3. Available skill metadata, when skills are available
4. Instruction sections, ordered as agent-home Markdown files, configured `prompt.instructions`, then workspace `AGENTS.md`
5. Configured `prompt.references`

If you replace the base prompt, include the template sections you want it to render. For example, a custom base prompt only includes configured instruction files if it contains `{{promptSections "INSTRUCTIONS" prompt.instructions}}`, and it only includes reference files if it contains `{{promptSections "REFERENCE" prompt.references}}`.

## Complete Context Example

The following commands shape the default agent with a custom base prompt, instruction files, reference files, a workspace, and shared skills:

```sh
imp config set agents.default.prompt.base '{"file":"./agents/default/prompts/SYSTEM.md"}'
imp config set agents.default.prompt.instructions '[{"file":"./agents/default/AGENTS.md"},{"file":"./agents/default/WORKFLOW.md"}]'
imp config set agents.default.prompt.references '[{"file":"./agents/default/RUNBOOK.md"}]'
imp config set agents.default.home ./agents/default
imp config set agents.default.workspace.cwd /path/to/project
imp config set agents.default.skills.paths '["./skills"]'
```

After changing context settings in the config, reload or restart the endpoint that uses the agent. After editing prompt, reference, or skill files, use a new chat turn so the agent can receive the updated context.

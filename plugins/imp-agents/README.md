# Imp Agent Pack

Imp Agent Pack is a bundled reference plugin that ships specialized Imp agents and practical plugin tools. It is meant to be useful in normal local development while still demonstrating how a plugin can provide agent definitions and trusted JS runtime tools.

## What it registers

- Agent: `imp-agents.cody`
- Tool: `imp-agents__workspaceSnapshot`

Plugin agents that do not set `home` get the same default home pattern as configured agents, using their runtime id: `<dataRoot>/agents/<pluginId>.<agentId>`.

## Cody

Cody is a pragmatic software engineering agent. It is configured with the standard file, shell, edit, plan, skill, and working-directory tools plus the plugin-provided `workspaceSnapshot` tool.

Cody uses `<agentHome>/MEMORY.md` as a small persistent workspace note. When a user says which repository to work in, Cody records it as `Current repo: /absolute/path` and uses that path as the default workspace in later chats because agent-home Markdown files are loaded into each turn.

`workspaceSnapshot` creates a shallow, read-only orientation summary for a workspace:

- project root and Git branch/status
- `package.json` metadata and scripts
- top-level entries
- nearby `AGENTS.md` instructions
- plugin manifests below the project root

## Layout

```text
plugins/imp-agents/
  plugin.json
  plugin.mjs
  prompts/
    cody.md
```

## Using it as a user plugin

Copy or symlink this directory to one of Imp's automatic plugin roots:

```text
<dataRoot>/plugins/imp-agents
<agentHome>/plugins/imp-agents
```

Imp auto-discovers plugins from `dataRoot/plugins` first and then from each configured agent's `plugins` directory. If the same plugin id exists in both locations, the agent-home plugin wins.

## JS runtime API demonstrated

The manifest declares:

```json
{
  "runtime": {
    "module": "./plugin.mjs"
  }
}
```

The module exports `registerPlugin(context)` and returns tool definitions. These tools run inside the Imp process, so use this style only for trusted plugin code. Prefer command tools or MCP servers for untrusted or independently deployable integrations.

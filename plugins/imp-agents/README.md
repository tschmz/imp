# Imp Agent Pack

Imp Agent Pack is a bundled reference plugin that ships specialized Imp agents and practical plugin tools. It is meant to be useful in normal local development while still demonstrating how a plugin can provide agent definitions and trusted JS runtime tools.

## What it registers

- Agent: `imp-agents.cody`
- JS runtime tool: `imp-agents__workspaceSnapshot`

Plugin agents that do not set `home` get the same default home pattern as configured agents, using their runtime id: `<dataRoot>/agents/<pluginId>.<agentId>`.

## Installation

Install the published package with Imp's plugin installer:

```sh
imp plugin install @tschmz/imp-agents
```

For local development from a checked-out repository, pass the parent plugin root explicitly:

```sh
imp plugin list --root plugins
imp plugin inspect imp-agents --root plugins
imp plugin install imp-agents --root plugins --config ~/.config/imp/config.json
```

After installation, Cody is visible in the effective config:

```sh
imp config get agents.*.id
imp config get agents.imp-agents.cody.name
```

## Cody

Cody is a pragmatic software engineering agent. It is configured with the standard file, shell, edit, plan, skill, and working-directory tools plus the plugin-provided `workspaceSnapshot` tool.

Cody uses `<agentHome>/MEMORY.md` as a small persistent workspace note. When a user says which repository to work in, Cody records it as `Current repo: /absolute/path` and uses that path as the default workspace in later chats because agent-home Markdown files are loaded into each turn.

Cody includes the `imp-administration` skill for safe Imp config, log, plugin, service, backup, and runtime diagnosis workflows. Cody also includes the `release-preparation` skill for repository release notes, versioning, validation, and tagging workflows.

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
  README.md
  prompts/
    cody.md
  skills/
    imp-administration/
      SKILL.md
    release-preparation/
      SKILL.md
```

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

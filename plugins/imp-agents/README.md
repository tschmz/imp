# Imp Agent Pack

Imp Agent Pack provides ready-made agents and trusted helper tools for Imp. It is useful when you want a packaged software-assistant agent without writing an agent config from scratch.

## What It Adds

- Agent: `imp-agents.cody`
- Tool: `imp-agents__workspaceSnapshot`
- Skills for Imp administration and release preparation

Plugin agents that do not set `home` get a default home under the active data root:

```text
<paths.dataRoot>/agents/<pluginId>.<agentId>
```

## Install

Install the published package:

```sh
imp plugin install @tschmz/imp-agents
```

For a checked-out repository:

```sh
imp plugin install imp-agents --root plugins --config /path/to/config.json
```

Validate and reload:

```sh
imp config validate --preflight
imp config reload
```

List agents:

```sh
imp config get agents.*.id
```

## Cody

`imp-agents.cody` is a pragmatic software-engineering agent. It is configured with file, shell, edit, plan, skill, and working-directory tools plus the plugin-provided workspace snapshot tool.

Cody can keep a small workspace note in its agent home. When you tell Cody which repository to work in, it can use that path as the default workspace in later chats.

## Workspace Snapshot Tool

`imp-agents__workspaceSnapshot` creates a shallow, read-only summary of a workspace, including:

- project root and Git status
- package metadata and scripts
- top-level files and directories
- nearby `AGENTS.md` instructions
- plugin manifests below the project root

## Trust Note

This plugin includes a trusted JavaScript runtime module. Install it only from a source you trust, because trusted plugin tools run inside the Imp process.

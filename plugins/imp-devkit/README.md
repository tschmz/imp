# Imp DevKit Plugin

Imp DevKit is a reference plugin for Imp plugin authors and Imp maintainers. It demonstrates an in-process JS runtime tool, plugin-provided skills, and a specialized coding agent for extending Imp.

## What it registers

- Agent: `imp-devkit.developer`
- Tool: `imp-devkit__describeManifest`
- Skills:
  - `imp-plugin-author`
  - `imp-architecture-reviewer`

## Layout

```text
plugins/imp-devkit/
  plugin.json
  plugin.mjs
  prompts/imp-developer.md
  skills/
    imp-plugin-author/
    imp-architecture-reviewer/
```

## Using it as a user plugin

Copy or symlink this directory to one of Imp's automatic plugin roots:

```text
<dataRoot>/plugins/imp-devkit
<agentHome>/plugins/imp-devkit
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

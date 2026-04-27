---
name: imp-plugin-author
description: Use when creating, reviewing, or extending Imp plugins, plugin manifests, plugin tools, plugin agents, or plugin-distributed skills.
---

# Imp Plugin Author

Use this skill when authoring an Imp plugin or changing the Imp plugin architecture.

## Core rules

1. Put user plugins in `dataRoot/plugins/<pluginId>` or `<agentHome>/plugins/<pluginId>`.
2. Use `imp-plugin.json` for user-authored plugins; bundled installable plugins may use `plugin.json`.
3. Use `schemaVersion: 1`.
4. Keep plugin ids stable and limited to letters, numbers, hyphens, and underscores.
5. Agent and MCP capabilities are exposed as `<pluginId>.<localId>`; tool capabilities are exposed as `<pluginId>__<localToolName>` to satisfy model provider tool-name constraints.
6. Agent-home plugins are discovered after data-root plugins and can override a global plugin with the same id.
7. Use `enabled: false` in `config.plugins` only when a plugin should be excluded from auto-loading.

## Capability choices

Prefer the least powerful extension point that solves the problem:

- Skills and prompt files for guidance-only behavior.
- MCP servers for established external integrations.
- Command tools for user code, scripts, Python, shell, or untrusted code.
- JS runtime tools only for trusted code that should run inside the Imp process.

## Files to check when changing plugin behavior

- `src/plugins/manifest.ts`
- `src/plugins/discovery.ts`
- `src/config/plugin-runtime.ts`
- `src/config/resolve-runtime-config.ts`
- `src/daemon/create-daemon.ts`
- `src/daemon/bootstrap/build-runtime-components.ts`
- `src/runtime/command-tool.ts`
- `src/runtime/js-plugin.ts`
- `src/config/schema.ts`
- relevant tests next to those files

## Validation

For source changes, run:

```bash
npm run check
npm test
```

For focused plugin work, run the relevant tests first, then the full suite before committing.

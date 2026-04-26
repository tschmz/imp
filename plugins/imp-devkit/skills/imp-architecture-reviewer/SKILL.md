---
name: imp-architecture-reviewer
description: Use when reviewing or modifying Imp architecture, runtime config, daemon startup, plugins, transports, skills, tools, or agent execution.
---

# Imp Architecture Reviewer

Use this skill when changes cross more than one Imp layer.

## Review checklist

- Identify the public config surface and update schema/types/tests.
- Check loaded config normalization and runtime config resolution.
- Check daemon/bootstrap integration.
- Check agent/tool resolution and duplicate-name validation.
- Check CLI/user-facing behavior and examples.
- Add regression tests for both success and failure behavior.
- Keep generated `dist/` out of source changes.

## Common Imp layering

1. `src/config/types.ts` defines config shapes.
2. `src/config/schema.ts` validates user config.
3. `src/config/load-app-config.ts` resolves config-level paths.
4. `src/config/resolve-runtime-config.ts` creates daemon runtime config.
5. `src/daemon/create-daemon.ts` validates agents and assembles runtime dependencies.
6. `src/daemon/bootstrap/*` prepares endpoint runtime components.
7. `src/runtime/*` resolves model, prompt, tools, skills, MCP, and execution.

When adding a new capability, make sure each affected layer has explicit behavior and tests.

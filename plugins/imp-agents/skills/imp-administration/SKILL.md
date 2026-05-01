---
name: imp-administration
description: Use this skill to inspect, configure, diagnose, back up, restore, or manage the live Imp installation.
---

# Imp Administration

## Hard Rules

- Use only `imp ...` commands for Imp administration.
- Do not read or write Imp config files directly. Use `imp config get` and `imp config set`.
- Never read or print secrets, tokens, API keys, auth file contents, or environment values.

## Config Commands

- Show schema: `imp config schema`
- Validate: `imp config validate --preflight`
- Read value: `imp config get <keyPath>`
- Set value: `imp config set <keyPath> <json-or-value>`

Prefer narrow key paths over broad config dumps. Address arrays by stable IDs when supported, for example `agents.<id>` or `endpoints.<id>`.

Use `*` to select multiple values from arrays or objects. Wildcard results are printed as JSON arrays:

```sh
imp config get agents.*.id
imp config get endpoints.*.enabled
```

## Diagnosis Commands

- Recent logs: `imp log --lines 10`
- Follow logs: `imp log --follow`
- Endpoint logs: `imp log --endpoint <endpoint-id> --lines 10`
- Service status: `imp service status`
- Plugin health: `imp plugin status <plugin-id>`
- Plugin diagnostics: `imp plugin doctor <plugin-id>`

When diagnosing, start with status and recent logs. Report symptoms, likely cause, and the next concrete `imp` command. Do not expose raw path values from logs.

### Plugin Operations

- List installable plugins: `imp plugin list`
- List plugins from a checked-out root: `imp plugin list --root <plugin-root>`
- Inspect plugin manifest: `imp plugin inspect <plugin-id>`
- Inspect plugin manifest from a checked-out root: `imp plugin inspect <plugin-id> --root <plugin-root>`
- Install published plugin package: `imp plugin install <npm-package-spec>`
- Update configured plugin package: `imp plugin update <plugin-id-or-npm-package-spec>`
- Check configured plugin: `imp plugin doctor <plugin-id>`
- Reinstall configured plugin services: `imp plugin install <plugin-id> --services-only`
- Skip plugin service installation when requested: `imp plugin install <npm-package-spec> --no-services`
- Update without starting plugin services when requested: `imp plugin update <plugin-id-or-npm-package-spec> --no-services`
- Overwrite existing plugin service definitions when explicitly requested: `imp plugin install <plugin-id-or-npm-package-spec> --force`

Use published npm package specs such as `@tschmz/imp-agents@latest` for normal installs and updates.

After plugin installs, updates, or plugin service reinstalls, run `imp config validate` and inspect `imp plugin status <plugin-id>`.

### Service Operations

- Status: `imp service status`
- Reload config first when possible: `imp config reload`
- Restart only when necessary: `imp service restart`
- Start stopped service: `imp service start`
- Stop service only when user asked for downtime: `imp service stop`

### Backups And Restore

- Create backup: `imp backup create`
- Scoped backup: `imp backup create --only config,agents,conversations`
- Inspect backup: `imp backup inspect <inputPath>`
- Restore: `imp restore <inputPath>`
- Scoped restore: `imp restore <inputPath> --only <scopes>`
- Restore to a requested config: `imp restore <inputPath> --config <path>`
- Restore data to a requested data root: `imp restore <inputPath> --data-root <path>`
- Overwrite existing restored files only when explicitly requested: `imp restore <inputPath> --force`

Before risky changes, create a backup unless user says not to.

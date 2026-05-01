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
- Read value: `imp config get <key-path>`
- Set value: `imp config set <key-path> <json-or-value>`

Prefer narrow key paths over broad config dumps. Address arrays by stable IDs when supported, for example `agents.<id>` or `endpoints.<id>`.

Use `*` to select multiple values from arrays or objects. Wildcard results are printed as JSON arrays:

```sh
imp config get agents.*.id
imp config get endpoints.*.enabled
```

## Diagnosis Commands

- Recent logs: `imp logs --lines 10`
- Follow logs: `imp logs --follow`
- Endpoint logs: `imp logs --endpoint <endpoint-id> --lines 10`
- Service status: `imp service status`
- Plugin health: `imp plugin status <plugin>`
- Plugin diagnostics: `imp plugin check <plugin>`

When diagnosing, start with status and recent logs. Report symptoms, likely cause, and the next concrete `imp` command. Do not expose raw path values from logs.

### Plugin Operations

- List installable plugins: `imp plugin list`
- List plugins from a checked-out root: `imp plugin list --root <plugin-root>`
- Inspect plugin manifest: `imp plugin inspect <plugin>`
- Inspect plugin manifest from a checked-out root: `imp plugin inspect <plugin> --root <plugin-root>`
- Install published plugin package: `imp plugin install <plugin>`
- Update configured plugin package: `imp plugin update <plugin>`
- Check configured plugin: `imp plugin check <plugin>`
- Reinstall configured plugin services: `imp plugin install <plugin> --services-only`
- Skip plugin service installation when requested: `imp plugin install <plugin> --no-services`
- Update without starting plugin services when requested: `imp plugin update <plugin> --no-services`
- Overwrite existing plugin service definitions when explicitly requested: `imp plugin install <plugin> --force`

Use published npm package specs such as `@tschmz/imp-agents@latest` for normal installs and updates.

After plugin installs, updates, or plugin service reinstalls, run `imp config validate` and inspect `imp plugin status <plugin>`.

### Service Operations

- Status: `imp service status`
- Reload config first when possible: `imp config reload`
- Restart only when necessary: `imp service restart`
- Start stopped service: `imp service start`
- Stop service only when user asked for downtime: `imp service stop`

### Backups And Restore

- Create backup: `imp backup create`
- Scoped backup: `imp backup create --only config,agents,conversations`
- Inspect backup: `imp backup inspect <archive>`
- Restore: `imp backup restore <archive>`
- Scoped restore: `imp backup restore <archive> --only <scopes>`
- Restore to a requested config: `imp backup restore <archive> --config <path>`
- Restore data to a requested data root: `imp backup restore <archive> --data-root <path>`
- Overwrite existing restored files only when explicitly requested: `imp backup restore <archive> --force`

Before risky changes, create a backup unless user says not to.

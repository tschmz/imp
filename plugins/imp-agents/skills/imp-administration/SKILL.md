---
name: imp-administration
description: Use this skill when user asks about the live Imp installation, config, endpoints, routing, logs, plugins, services, backups, restore or runtime diagnosis.
---

# Imp Administration

## Hard Rules

- Use only `imp ...` commands for Imp administration.
- Do not read or write Imp config files directly. Use `imp config get` and `imp config set`.
- Never read or print secrets, tokens, API keys, auth file contents, or environment values.

## Config Commands

- Show schema: `imp config schema`
- Validate: `imp config validate`
- Read value: `imp config get <keyPath>`
- Set value: `imp config set <keyPath> <json-or-value>`

Prefer narrow key paths over broad config dumps. Address arrays by stable IDs when supported, for example `agents.<id>` or `endpoints.<id>`.

Use `*` to select multiple values from arrays or objects. Wildcard results are printed as JSON arrays:

```sh
imp config get agents.*.id
imp config get endpoints.*.enabled
```

## Diagnosis Commands

- Recent logs: `imp log --lines 50`
- Follow logs: `imp log --follow`
- Endpoint logs: `imp log --endpoint <endpoint-id> --lines 50`
- Service status: `imp service status`
- Plugin health: `imp plugin status <plugin-id>`
- Plugin diagnostics: `imp plugin doctor <plugin-id>`

When diagnosing, start with status and recent logs. Report symptoms, likely cause, and the next concrete `imp` command. Do not expose raw path values from logs.

### Plugin Operations

- List installable plugins: `imp plugin list`
- Inspect plugin manifest: `imp plugin inspect <plugin-id>`
- Install plugin: `imp plugin install <plugin-id>`
- Check configured plugin: `imp plugin doctor <plugin-id>`
- Reinstall configured plugin services: `imp plugin install <plugin-id> --services-only`

After plugin installs or service changes, run `imp config validate` and inspect `imp plugin status <plugin-id>`.

### Service Operations

- Status: `imp service status`
- Reload config first when possible: `imp config reload`
- Restart only when necessary: `imp service restart`
- Start stopped service: `imp service start`
- Stop service only when user asked for downtime: `imp service stop`

### Backups And Restore

- Create backup: `imp backup create`
- Scoped backup: `imp backup create --only config,agents,conversations`
- Restore: `imp restore <inputPath>`
- Scoped restore: `imp restore <inputPath> --only <scopes>`

Before risky changes, create a backup unless user says not to. If a command requires a backup path, ask user for it rather than inventing or revealing local directory locations.

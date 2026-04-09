# Backups

`imp` can create and restore backup archives for the active installation.

## Create A Backup

Create a full backup:

```bash
imp backup create
```

Write to a specific archive path:

```bash
imp backup create --output /tmp/imp-backup.tar
```

Overwrite an existing archive:

```bash
imp backup create --force
```

## Backup Scopes

You can limit the backup to selected scopes:

- `config`
- `agents`
- `conversations`

Examples:

```bash
imp backup create --only conversations
imp backup create --only config,agents
```

By default, backups include:

- the active config file
- prompt and auth files referenced by the config
- bot conversation stores under `paths.dataRoot`

Current backup behavior does **not** include Telegram token secret files referenced via `bots[].token.file`.
Those files stay outside the archive and must be backed up separately if you use file-based token references.
Environment-variable-based token references also do not embed the secret value into the backup archive.

If a referenced prompt or auth file is missing, backup creation fails instead of producing a partial archive.

## Restore A Backup

Restore everything and overwrite existing files:

```bash
imp restore /path/to/imp-backup.tar --force
```

Restore into a different installation target:

```bash
imp restore /path/to/imp-backup.tar \
  --config /path/to/config.json \
  --data-root /path/to/data-root \
  --force
```

Restore only selected scopes:

```bash
imp restore /path/to/imp-backup.tar --only conversations --force
```

## Important Restore Behavior

- conversation restores replace only the targeted conversation subtree
- unrelated runtime data under `paths.dataRoot` is left untouched
- `--only agents` is stricter and requires either `config` to be restored too, or an already existing target config

This prevents agent files from being restored into an undefined layout.

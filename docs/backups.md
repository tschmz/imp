# Backups

Imp can create and restore backup archives for the active installation. Backups are useful before changing config, moving an installation, or replacing a machine.

## Create a Backup

Create a full backup:

```sh
imp backup create
```

Write the archive to a specific path:

```sh
imp backup create --output /tmp/imp-backup.tar
```

Overwrite an existing archive:

```sh
imp backup create --force
```

## Choose Backup Scopes

By default, a backup includes:

- The active config file
- Prompt and auth files referenced by the config
- Conversations under `paths.dataRoot/conversations`

Limit the backup to selected scopes when needed:

```sh
imp backup create --only conversations
imp backup create --only config,agents
```

Available scopes are `config`, `agents`, and `conversations`.

Telegram token secret files referenced through `endpoints[].token.file` are not included in the archive. Back them up separately if you use file-based token references. Environment-variable token references also do not embed the secret value into the archive.

If a referenced prompt or auth file is missing, backup creation fails instead of producing a partial archive.

## Restore a Backup

Restore everything and overwrite existing files:

```sh
imp restore /path/to/imp-backup.tar --force
```

Restore into a different installation target:

```sh
imp restore /path/to/imp-backup.tar \
  --config /path/to/config.json \
  --data-root /path/to/data-root \
  --force
```

Restore only selected scopes:

```sh
imp restore /path/to/imp-backup.tar --only conversations --force
```

## Restore Behavior

Conversation restores replace the shared conversation store. Other runtime data under `paths.dataRoot` is left untouched.

`--only agents` requires either a restored config or an already existing target config, because agent files need a defined installation layout.

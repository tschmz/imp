# imp Plugin Packages

Plugin packages maintained with this repository live here as direct subdirectories with a `plugin.json` manifest.

```text
plugins/
  imp-voice/
    plugin.json
```

Published users should install plugins from npm, for example `imp plugin install @tschmz/imp-voice`.
For local development from this repository, pass the explicit plugin root:

```bash
imp plugin list --root plugins
imp plugin inspect imp-voice --root plugins
imp plugin install imp-voice --root plugins --config ~/.config/imp/config.json
```

# imp Plugin Packages

Plugin packages maintained with this repository live here as direct subdirectories with a `plugin.json` manifest.

```text
plugins/
  imp-voice/
    plugin.json
  imp-phone/
    plugin.json
  imp-agents/
    plugin.json
```

Published users should install plugins from npm, for example `imp plugin install @tschmz/imp-voice` or `imp plugin install @tschmz/imp-phone`. `imp-agents` is a local reference plugin for bundled specialized agents and plugin tools.
For local development from this repository, pass the explicit plugin root:

```bash
imp plugin list --root plugins
imp plugin inspect imp-voice --root plugins
imp plugin install imp-voice --root plugins --config ~/.config/imp/config.json
imp plugin inspect imp-phone --root plugins
imp plugin install imp-phone --root plugins --config ~/.config/imp/config.json
imp plugin inspect imp-agents --root plugins
```

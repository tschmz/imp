# Bundled Plugins

This repository includes plugin packages that can be installed into an Imp configuration. End users normally install the published packages with `imp plugin install`.

## Available Plugins

| Plugin | What it adds |
| --- | --- |
| `imp-voice` | Local voice input/output companion services |
| `imp-phone` | Turn-based SIP phone integration and phone tools |
| `imp-agents` | Bundled specialized agents and trusted tools |

## Install Published Packages

```sh
imp plugin install @tschmz/imp-voice
imp plugin install @tschmz/imp-phone
imp plugin install @tschmz/imp-agents
```

Pass `--config /path/to/config.json` if you manage more than one Imp installation.

## Install From a Checked-Out Repository

When testing plugins from this repository, pass the plugin root explicitly:

```sh
imp plugin list --root plugins
imp plugin inspect imp-voice --root plugins
imp plugin install imp-voice --root plugins --config /path/to/config.json
```

Replace `imp-voice` with `imp-phone` or `imp-agents` as needed.

After installation:

```sh
imp config validate --preflight
imp config reload
```

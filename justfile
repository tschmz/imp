set shell := ["bash", "-cu"]

# Show available recipes.
default:
  just --list

# Remove build artifacts.
clean:
  npm run clean

# Run typecheck, lint, and tests.
check:
  npm run check
  npm test

# Compile the project into dist/.
build:
  npm run build

# Clean and rebuild the project.
rebuild: clean build

# Preview the npm package contents without creating a tarball.
pack-dry-run:
  npm pack --dry-run

# Build and create a local npm tarball.
pack: clean build
  npm pack

# Build and run the local CLI with custom arguments.
run *args: build
  node dist/main.js {{args}}

# Create a config file through the CLI bootstrap command.
init *args: build
  node dist/main.js init {{args}}

# Install the package globally from the local checkout.
install: clean build
  npm install -g .
  npm install -g ./plugins/imp-voice
  npm install -g ./plugins/imp-phone
  just _install-managed-plugin "{{justfile_directory()}}/plugins/imp-voice"
  just _install-managed-plugin "{{justfile_directory()}}/plugins/imp-phone"
  if command -v systemctl >/dev/null && systemctl --user list-unit-files imp-voice-in.service >/dev/null 2>&1; then systemctl --user restart imp-voice-in.service imp-voice-out.service; fi
  if command -v systemctl >/dev/null && systemctl --user list-unit-files imp-phone-controller.service >/dev/null 2>&1; then systemctl --user restart imp-phone-controller.service; fi

_install-managed-plugin plugin_root:
  #!/usr/bin/env bash
  set -euo pipefail

  config_path="${IMP_CONFIG_PATH:-}"
  if [[ -z "$config_path" && -f "${XDG_CONFIG_HOME:-$HOME/.config}/imp/config.json" ]]; then
    config_path="${XDG_CONFIG_HOME:-$HOME/.config}/imp/config.json"
  fi
  if [[ -z "$config_path" ]]; then
    exit 0
  fi

  data_root="$(
    node -e 'const fs = require("node:fs"); const path = require("node:path"); const configPath = path.resolve(process.argv[1]); const config = JSON.parse(fs.readFileSync(configPath, "utf8")); const dataRoot = config?.paths?.dataRoot; if (typeof dataRoot !== "string" || dataRoot.length === 0) { console.error(`Missing paths.dataRoot in ${configPath}`); process.exit(2); } console.log(path.resolve(path.dirname(configPath), dataRoot));' "$config_path"
  )"
  npm install "{{plugin_root}}" --prefix "$data_root/plugins/npm" --omit=dev --no-audit --no-fund

# Remove the globally installed package.
uninstall:
  npm uninstall -g @tschmz/imp

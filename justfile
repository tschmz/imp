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

# Build package tarballs and install those locally.
install:
  #!/usr/bin/env bash
  set -euo pipefail

  package_dir="$(mktemp -d "${TMPDIR:-/tmp}/imp-install-packages.XXXXXX")"
  trap 'rm -rf "$package_dir"' EXIT

  pack_package() {
    local package_root="$1"
    local packed
    packed="$(cd "$package_root" >/dev/null && npm pack --pack-destination "$package_dir" --silent | tail -n 1)"
    if [[ "$packed" = /* ]]; then
      printf '%s\n' "$packed"
    else
      printf '%s/%s\n' "$package_dir" "$packed"
    fi
  }

  npm run clean
  npm run build

  imp_package="$(pack_package ".")"
  voice_package="$(pack_package "plugins/imp-voice")"
  phone_package="$(pack_package "plugins/imp-phone")"

  npm install -g "$imp_package"
  npm install -g "$voice_package"
  npm install -g "$phone_package"
  just _install-managed-plugin "$voice_package"
  just _install-managed-plugin "$phone_package"
  # Keep the currently running imp daemon alive during local installs; only managed plugin services are restarted here.
  if command -v systemctl >/dev/null && systemctl --user list-unit-files imp-voice-in.service >/dev/null 2>&1; then systemctl --user restart imp-voice-in.service imp-voice-out.service; fi
  if command -v systemctl >/dev/null && systemctl --user list-unit-files imp-phone-controller.service >/dev/null 2>&1; then systemctl --user restart imp-phone-controller.service; fi

_install-managed-plugin package_spec:
  #!/usr/bin/env bash
  set -euo pipefail

  config_path=""
  if [[ -n "${IMP_CONFIG_PATH:-}" && -f "${IMP_CONFIG_PATH}" ]]; then
    config_path="${IMP_CONFIG_PATH}"
  elif [[ -f "${XDG_CONFIG_HOME:-$HOME/.config}/imp/config.json" ]]; then
    config_path="${XDG_CONFIG_HOME:-$HOME/.config}/imp/config.json"
  elif [[ -f /etc/imp/config.json ]]; then
    config_path="/etc/imp/config.json"
  fi
  if [[ -z "$config_path" ]]; then
    exit 0
  fi

  data_root="$(
    node -e 'const fs = require("node:fs"); const path = require("node:path"); const configPath = path.resolve(process.argv[1]); const config = JSON.parse(fs.readFileSync(configPath, "utf8")); const dataRoot = config?.paths?.dataRoot; if (typeof dataRoot !== "string" || dataRoot.length === 0) { console.error(`Missing paths.dataRoot in ${configPath}`); process.exit(2); } console.log(path.resolve(path.dirname(configPath), dataRoot));' "$config_path"
  )"
  npm install "{{package_spec}}" --prefix "$data_root/plugins/npm" --omit=dev --no-audit --no-fund

# Remove the globally installed package.
uninstall:
  npm uninstall -g @tschmz/imp

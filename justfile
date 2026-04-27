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

# Build package tarballs and install Imp locally. Use --plugins or --plugin <id> to include plugins.
install *args:
  #!/usr/bin/env bash
  set -euo pipefail

  known_plugins=(imp-agents imp-voice imp-phone)
  declare -A plugin_roots=(
    [imp-agents]="plugins/imp-agents"
    [imp-voice]="plugins/imp-voice"
    [imp-phone]="plugins/imp-phone"
  )
  declare -A selected_plugins=()
  include_all_plugins=0

  print_usage() {
    printf '%s\n' \
      "Usage:" \
      "  just install" \
      "  just install --plugins" \
      "  just install --plugin imp-voice" \
      "  just install --plugins=imp-agents,imp-voice,imp-phone" \
      "" \
      "Options:" \
      "  --plugins                 Include all plugin packages." \
      "  --plugins=<ids>           Include comma-separated plugin ids." \
      "  --plugin <id>             Include one plugin package. May be repeated." \
      "  --plugin=<id>             Include one plugin package. May be repeated." \
      "  -h, --help                Show this help."
  }

  add_plugin() {
    local plugin_id="$1"
    if [[ -z "$plugin_id" ]]; then
      echo "Missing plugin id." >&2
      exit 2
    fi
    if [[ -z "${plugin_roots[$plugin_id]+x}" ]]; then
      echo "Unknown plugin: $plugin_id" >&2
      echo "Known plugins: ${known_plugins[*]}" >&2
      exit 2
    fi
    selected_plugins["$plugin_id"]=1
  }

  add_plugin_list() {
    local plugin_list="$1"
    local plugin_id
    if [[ -z "$plugin_list" ]]; then
      echo "Missing plugin list." >&2
      exit 2
    fi
    IFS=',' read -r -a plugin_ids <<< "$plugin_list"
    for plugin_id in "${plugin_ids[@]}"; do
      plugin_id="${plugin_id//[[:space:]]/}"
      add_plugin "$plugin_id"
    done
  }

  set -- {{args}}
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --plugins|--all-plugins)
        include_all_plugins=1
        shift
        ;;
      --plugins=*)
        add_plugin_list "${1#--plugins=}"
        shift
        ;;
      --plugin=*)
        add_plugin "${1#--plugin=}"
        shift
        ;;
      --plugin)
        shift
        if [[ "$#" -eq 0 ]]; then
          echo "Missing value for --plugin." >&2
          exit 2
        fi
        add_plugin "$1"
        shift
        ;;
      -h|--help)
        print_usage
        exit 0
        ;;
      *)
        echo "Unknown install option: $1" >&2
        print_usage >&2
        exit 2
        ;;
    esac
  done

  if [[ "$include_all_plugins" -eq 1 ]]; then
    for plugin_id in "${known_plugins[@]}"; do
      selected_plugins["$plugin_id"]=1
    done
  fi

  plugins_to_install=()
  for plugin_id in "${known_plugins[@]}"; do
    if [[ -n "${selected_plugins[$plugin_id]+x}" ]]; then
      plugins_to_install+=("$plugin_id")
    fi
  done

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
  declare -A plugin_packages=()
  for plugin_id in "${plugins_to_install[@]}"; do
    plugin_packages["$plugin_id"]="$(pack_package "${plugin_roots[$plugin_id]}")"
  done

  if [[ "${#plugins_to_install[@]}" -eq 0 ]]; then
    echo "Installing Imp package."
  else
    echo "Installing Imp package and plugins: ${plugins_to_install[*]}"
  fi
  npm install -g "$imp_package"
  for plugin_id in "${plugins_to_install[@]}"; do
    just _install-managed-plugin "${plugin_packages[$plugin_id]}" "$plugin_id"
  done

_install-managed-plugin package_spec plugin_id:
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
    echo "No Imp config found; cannot activate plugin \"{{plugin_id}}\". Run imp init first or set IMP_CONFIG_PATH." >&2
    exit 2
  fi

  install_output=""
  if install_output="$(node dist/main.js plugin install "{{package_spec}}" --config "$config_path" --force 2>&1)"; then
    printf '%s\n' "$install_output"
    exit 0
  fi
  install_status="$?"
  if [[ "$install_output" != *"is already configured"* ]]; then
    printf '%s\n' "$install_output" >&2
    exit "$install_status"
  fi

  printf 'Plugin "%s" is already configured; updating managed package and services.\n' "{{plugin_id}}"
  data_root="$(
    node -e 'const fs = require("node:fs"); const path = require("node:path"); const configPath = path.resolve(process.argv[1]); const config = JSON.parse(fs.readFileSync(configPath, "utf8")); const dataRoot = config?.paths?.dataRoot; if (typeof dataRoot !== "string" || dataRoot.length === 0) { console.error(`Missing paths.dataRoot in ${configPath}`); process.exit(2); } console.log(path.resolve(path.dirname(configPath), dataRoot));' "$config_path"
  )"
  npm install "{{package_spec}}" --prefix "$data_root/plugins/npm" --omit=dev --no-audit --no-fund
  node dist/main.js plugin install "{{plugin_id}}" --config "$config_path" --services-only --force

# Remove the globally installed package.
uninstall:
  npm uninstall -g @tschmz/imp

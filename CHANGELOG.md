# Changelog

All notable changes to this project will be documented in this file.

## 0.3.0 - 2026-04-12

### Changed

- Improve skill loading paths, prompt skill metadata, and bundled skill resource reporting.
- Inject output writers into config-related application use cases.
- Centralize conversation file writes in filesystem-backed storage.
- Share node error guards across filesystem, logging, service, and storage helpers.
- Reuse the shared missing-file guard in file logger and Linux service environment handling.

### Fixed

- Omit the Telegram endpoint from `imp init --defaults` starter configs so local CLI-only setups validate without daemon endpoints.
- Share config JSON parsing so config load and update paths handle malformed JSON consistently, including UTF-8 BOM stripping.

## 0.2.0 - 2026-04-12

### Added

- Add an interactive CLI chat endpoint.

### Fixed

- Escape systemd `WorkingDirectory` and `EnvironmentFile` service paths.

## 0.1.1 - 2026-04-12

### Changed

- Removed legacy session migration and replay fallbacks.

### Fixed

- Resolve relative agent `cd` tool paths from the current agent working directory.
- Honor explicit Linux service environment file paths.
- Reject partially numeric session indexes such as `/restore 1abc`.
- Preserve spaces in tar archive entry paths.
- Reject malformed tar numeric fields.
- Sanitize dot-only conversation session path segments.
- Reject endpoint IDs that are unsafe for runtime file paths.
- Quote systemd `WorkingDirectory` and `EnvironmentFile` service paths.

## 0.1.0 - 2026-04-12

### Added

- Local `imp` daemon for running persistent personal AI agent endpoints.
- Configurable agents with model selection, prompt customization, tools, optional skills, and optional workspaces.
- Telegram endpoint support with persistent conversation sessions and agent routing.
- Telegram commands for session management, agent switching, status, config, logs, and runtime control.
- Built-in tool configuration for filesystem and shell-oriented agent workflows.
- MCP server configuration for agent tools.
- Skill discovery from configured skill paths and workspace-local `.skills` directories.
- Config CLI for initialization, validation, inspection, updates, and reloads.
- Backup and restore commands for config, agent files, and conversation data.
- Foreground daemon mode and background service management for Linux and macOS.
- Optional Telegram voice transcription through OpenAI transcription models.

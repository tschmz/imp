# Changelog

All notable changes to this project will be documented in this file.

## 0.10.0 - 2026-04-19

### Added

- Add bundled phone call support, including the phone call tool, call request handling, persisted call results, contact comments, purpose propagation, and finalized phone call notes.
- Add runtime clock prompt variables, including minute-level values.
- Add ElevenLabs TTS support in the bundled voice plugin.
- Add a simplified default phone prompt.

### Fixed

- Preserve the configured phone call agent during phone call execution.
- Allow agents to produce no reply output when appropriate.
- Skip cached system prompt snapshots.

## 0.9.0 - 2026-04-19

### Added

- Add voice capture, accepted, and error feedback tones in the bundled voice plugin.
- Add configurable voice close phrases.
- Soften the bundled voice follow-up tone.

### Fixed

- Remove the voice speaker wait timeout in the bundled voice plugin.

## 0.8.0 - 2026-04-19

### Added

- Append conversation events while agent runs and track per-session run state.
- Mark interrupted sessions at startup and continue them safely on the next daemon run.
- Replay the active session in chat.
- Store system prompt snapshots with conversation history.

### Changed

- Store conversations as event logs.
- Improve agent failure logging for runtime and engine errors.
- Split config schema, plugin transport, and runtime tool resolution into focused modules.

### Fixed

- Resolve `dataRoot` relative to the config file path.
- Collapse tool results in full conversation exports.

## 0.7.0 - 2026-04-19

### Added

- Export conversations as HTML and deliver export files over Telegram.
- Resume saved sessions by replaying their conversation history.
- Add agent-scoped logging.

### Changed

- Refine default skill prompt instructions.
- Simplify the bundled voice wake trigger flow.
- Replace daemon no-op control with a deferred action controller.
- Modularize CLI command registration.
- Split plugin management use cases into focused modules.
- Switch tar archive handling to `tar-stream`.
- Use proper lockfiles and atomic writes for filesystem-backed state.
- Rework Telegram Markdown parsing with a dedicated parser.

### Fixed

- Continue speaker outbox processing after playback failures and fail once mode when every file fails.
- Preserve blockquote newlines and keep Telegram link parsing working after invalid patterns and for valid bracketed targets.
- Enforce configured checks for services-only installs.
- Parse plugin package specs correctly.
- Refine default prompt channel guidance.

## 0.6.0 - 2026-04-18

### Added

- Add plugin manifest discovery, inspection, and install commands.
- Support installing plugins from npm package specs.
- Bundle the `imp-voice` voice frontend plugin package with the repository.
- Support custom service install plans.
- Share agent conversation sessions across endpoints.

### Changed

- Restrict audio outbox prompt output to the reply content.
- Install the managed `imp-voice` plugin during local `just install` runs.

### Fixed

- Stop creating endpoint root directories.

## 0.5.0 - 2026-04-18

### Added

- Add external plugin endpoints with plugin protocol support for file handling and output controls.
- Expose reply-channel context in prompts so agents can adapt responses to the active transport.
- Support Telegram document uploads.
- Allow plugin speech model configuration.

### Fixed

- Stop plugin polling cleanly after shutdown.

## 0.4.0 - 2026-04-13

### Added

- Auto-discover skills from `paths.dataRoot/skills`, `agent.home/.skills`, and `<working-directory>/.skills`, with later catalogs overriding earlier skills for the current turn.
- Install the bundled `imp-skill-creator` skill when `imp init` writes a starter setup.
- Load direct `*.md` files from the agent home as instruction blocks before explicit `prompt.instructions` and workspace `AGENTS.md`.

### Fixed

- Re-read skill content from disk when `load_skill` runs so edited skills are picked up without a restart.

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

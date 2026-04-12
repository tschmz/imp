# Changelog

All notable changes to this project will be documented in this file.

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

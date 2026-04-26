# Imp Architecture Map

- CLI: `src/main.ts`, `src/cli/*`
- Use cases: `src/application/*`
- Config: `src/config/*`
- Plugins: `src/plugins/*`, `src/config/plugin-runtime.ts`
- Daemon: `src/daemon/*`
- Runtime/agents/tools: `src/runtime/*`, `src/tools/*`, `src/agents/*`
- Skills: `src/skills/*`
- Transports: `src/transports/*`
- Storage/logging/files: `src/storage/*`, `src/logging/*`, `src/files/*`

Tests live next to source files as `*.test.ts`; plugin package tests may be `.mjs` under `plugins/<id>/test`.

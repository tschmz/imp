# Imp Plugin Manifest Reference

A minimal plugin manifest:

```json
{
  "schemaVersion": 1,
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0"
}
```

Common capabilities:

- `skills`: skill roots relative to the plugin directory.
- `agents`: agent definitions shipped by the plugin. Runtime ids become `<pluginId>.<agentId>`. If `home` is omitted, Imp uses `<dataRoot>/agents/<pluginId>.<agentId>`.
- `tools`: command tools. Runtime names become `<pluginId>__<toolName>` because model provider tool names may not contain dots.
- `runtime.module`: trusted JS module that can register in-process tools.
- `mcpServers`: MCP servers. Runtime ids become `<pluginId>.<serverId>`.
- `endpoints` and `services`: installable plugin integration points used by service-style plugins.

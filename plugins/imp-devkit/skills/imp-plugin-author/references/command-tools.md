# Command Tools

Command tools are safer for arbitrary user code because they run in a child process.

The command receives JSON on stdin:

```json
{
  "schemaVersion": 1,
  "pluginId": "my-plugin",
  "toolName": "my-plugin.search",
  "input": {}
}
```

The command may print either a full tool result JSON object with `content`, or plain text. Non-zero exit codes surface as tool execution errors.

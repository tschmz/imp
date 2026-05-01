---
name: imp-plugin-dev
description: Use this skill to create, extend, debug, or document a plugin that adds tools for yourself.
---

# Imp Plugin Development

Use this skill to add local Imp tools for yourself.

{{#if agent.home}}
Create these plugins under `{{agent.home}}/.plugins/<plugin-id>`.
{{else}}
Your home path is not available in this turn. Ask the user for the target directory before creating a plugin.
{{/if}}

## Hard Rules

- Create plugins under `{{agent.home}}/.plugins/<plugin-id>` unless the user explicitly gives another target.
- Use `imp-plugin.json` as the plugin manifest.
- Do not edit Imp config files or install a package just to expose a local tool. Plugins in `{{agent.home}}/.plugins` are auto-discovered.
- Do not hardcode secrets, tokens, API keys, auth file contents, or environment values.
- Keep plugin IDs and tool names to letters, numbers, hyphens, and underscores. Avoid `__` in local tool names because Imp uses `<plugin-id>__<tool-name>` as the runtime tool name.
- A newly created or changed tool is available on your next turn. The current turn's tool list was already resolved before the plugin was written.

## Location And Discovery

Use this plugin directory:

```text
{{agent.home}}/.plugins/<plugin-id>
```

Directory shape:

```text
{{agent.home}}/
  .plugins/
    my_tools/
      imp-plugin.json
      plugin.mjs
```

Imp scans one directory level below `.plugins`. Each child directory is one plugin. The manifest must be named `imp-plugin.json`.

Runtime tool names are namespaced:

- Plugin ID: `my_tools`
- Local tool name: `summarize_file`
- Tool exposed to you: `my_tools__summarize_file`
- Alias accepted in configured tool references: `my_tools.summarize_file`

Tools from `{{agent.home}}/.plugins` are automatically added to your available tools on each turn.

## Minimal JavaScript Plugin

Create `{{agent.home}}/.plugins/my_tools/imp-plugin.json`:

```json
{
  "schemaVersion": 1,
  "id": "my_tools",
  "name": "My Tools",
  "version": "0.1.0",
  "description": "Local tools for me.",
  "runtime": {
    "module": "./plugin.mjs"
  }
}
```

Create `{{agent.home}}/.plugins/my_tools/plugin.mjs`:

```js
export function registerPlugin(context) {
  return {
    tools: [
      {
        name: "echo",
        description: "Echo text back.",
        parameters: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Text to echo."
            }
          },
          required: ["text"],
          additionalProperties: false
        },
        executionMode: "sequential",
        async execute(_toolCallId, params, signal) {
          if (signal?.aborted) {
            throw new Error("Tool call was aborted.");
          }

          const text = String(params?.text ?? "");
          return {
            content: [
              {
                type: "text",
                text
              }
            ],
            details: {
              pluginRoot: context.plugin.rootDir
            }
          };
        }
      }
    ]
  };
}
```

Supported JS module exports:

- `export function registerPlugin(context) { return { tools: [...] }; }`
- `export default function (context) { return { tools: [...] }; }`
- `export default { tools: [...] }`
- `export const tools = [...]`

`context` has:

```js
{
  plugin: {
    id: "my_tools",
    rootDir: "{{agent.home}}/.plugins/my_tools"
  }
}
```

Tool objects must define:

- `name`: local tool name, for example `echo`
- `description`: clear user-facing description
- `parameters`: JSON Schema object for arguments
- `execute(toolCallId, params, signal, onUpdate)`: async function returning a tool result

Tool results should use this shape:

```js
{
  content: [
    {
      type: "text",
      text: "Human-readable result"
    }
  ],
  details: {
    structured: "optional machine-readable data"
  }
}
```

## Command Tool Alternative

Use command tools when the tool is better implemented as an executable script. Paths are relative to the plugin root, and the default working directory is the plugin root.

`imp-plugin.json`:

```json
{
  "schemaVersion": 1,
  "id": "text_tools",
  "name": "Text Tools",
  "version": "0.1.0",
  "tools": [
    {
      "name": "word_count",
      "description": "Count words in text.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string"
          }
        },
        "required": ["text"],
        "additionalProperties": false
      },
      "runner": {
        "type": "command",
        "command": "node",
        "args": ["./word-count.mjs"],
        "timeoutMs": 10000
      }
    }
  ]
}
```

`word-count.mjs`:

```js
const request = JSON.parse(await readStdin());
const text = String(request.input?.text ?? "");
const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/u).length;

process.stdout.write(JSON.stringify({
  content: [
    {
      type: "text",
      text: String(words)
    }
  ],
  details: {
    words
  }
}));

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}
```

Command tools receive one JSON request on stdin:

```json
{
  "schemaVersion": 1,
  "pluginId": "text_tools",
  "toolName": "text_tools__word_count",
  "input": {
    "text": "hello world"
  }
}
```

If stdout is JSON with a `content` array, Imp uses it as the tool result. If stdout is other JSON, Imp returns it as `details` and also exposes the trimmed JSON text. If stdout is plain text, Imp returns it as text.

## Manifest Reference

Common fields for local tool plugins:

```json
{
  "schemaVersion": 1,
  "id": "plugin_id",
  "name": "Human Name",
  "version": "0.1.0",
  "description": "Optional description.",
  "runtime": {
    "module": "./plugin.mjs"
  },
  "tools": []
}
```

Use `runtime` for JavaScript tools and `tools` for command tools. Relative paths are resolved from the plugin root.

## Development Workflow

1. Pick a focused plugin ID and one small tool.
2. Create `{{agent.home}}/.plugins/<plugin-id>/imp-plugin.json`.
3. Add either `plugin.mjs` with `runtime.module` or command tool scripts with `tools[].runner`.
4. Validate syntax locally:

   ```sh
   node --check {{agent.home}}/.plugins/<plugin-id>/plugin.mjs
   ```

5. Use the new tool from the next turn.
6. If the tool does not appear, check recent logs:

   ```sh
   imp log --lines 10
   ```

## Troubleshooting

- Invalid manifest: ensure `schemaVersion` is `1`, identifiers contain only letters, numbers, hyphens, and underscores, and duplicate tool names are not present.
- JS plugin load failure: ensure the runtime file exists, is valid ESM, and exports one of the supported shapes.
- Tool name mismatch: call or look for the namespaced name `<plugin-id>__<tool-name>`.
- Command tool failure: check the subprocess exit code, stderr, and that stdout returns valid JSON with a `content` array.
- Missing new tool immediately after creation: wait for the next turn; tools are resolved before each turn starts.

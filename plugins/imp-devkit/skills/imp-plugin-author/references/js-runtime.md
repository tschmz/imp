# JS Runtime Plugins

A JS runtime plugin declares:

```json
{
  "runtime": {
    "module": "./plugin.mjs"
  }
}
```

The module can export `registerPlugin(context)`:

```js
export function registerPlugin(context) {
  return {
    tools: [
      {
        name: "example",
        description: "Example tool.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        async execute(toolCallId, params) {
          return {
            content: [{ type: "text", text: "ok" }],
            details: { pluginId: context.plugin.id }
          };
        }
      }
    ]
  };
}
```

JS runtime tools run inside the Imp process. Use them only for trusted code.

# Agent Tools

Agent tools define what an agent is allowed to do outside normal text generation. Tools are configured per agent, so different agents can have different access.

The examples use `agents.default` to address the agent with the ID `default`.

## Built-in Tools

Set the built-in tools for an agent:

```sh
imp config set agents.default.tools '["read","bash","edit","write","grep","find","ls","update_plan"]'
```

Common built-in tools are:

- `read`: read files from disk
- `bash`: run shell commands in the current working directory
- `edit`: edit existing files
- `write`: create or overwrite files
- `grep`: search file contents
- `find`: search for files by pattern
- `ls`: list directory contents
- `update_plan`: maintain a concise progress plan for multi-step work
- `pwd`: show the current working directory
- `cd`: change the working directory for later file and shell tool calls

Use a smaller list when an agent only needs read-only access:

```sh
imp config set agents.default.tools '["read","grep","find","ls"]'
```

## Shell Environment

The `bash` tool uses the environment of the running Imp process. If an agent needs extra command search paths, set `workspace.shellPath`:

```sh
imp config set agents.default.workspace.shellPath '["/usr/local/bin","/usr/bin","/bin"]'
```

`workspace.shellPath` affects the agent's shell tool only. Provider credentials and service-wide environment variables still belong in the shell or service environment that starts Imp.

## MCP Servers

MCP servers are defined once at the top level and then enabled per agent.

Define a server:

```sh
imp config set tools.mcp '{"inheritEnv":["GITHUB_TOKEN"],"servers":[{"id":"github","command":"github-mcp-server","args":["stdio"]}]}'
```

Allow the default agent to use it:

```sh
imp config set agents.default.tools '{"builtIn":["read","bash"],"mcp":{"servers":["github"]}}'
```

Agents only receive MCP tools from the servers listed in their own `tools.mcp.servers` array.

## Delegated Agents

An agent can expose another configured agent as an explicit tool. The delegated agent runs with its own prompt, model, workspace, and tools.

```sh
imp config set agents.default.tools '{"builtIn":["read","bash"],"agents":[{"agentId":"writer","toolName":"draft_copy","description":"Ask the writer agent for draft copy."}]}'
```

Each delegated tool accepts a single text input and returns the delegated agent's final answer. Delegated runs do not change the child agent's active session.

## Phone Tools

The `imp-phone` plugin exposes phone tools through its packaged MCP server. Install the plugin, then allow an agent to use the `imp-phone` MCP server and configure its contact allowlist under `agents[].tools.phone`.

```sh
imp config set agents.default.tools '{"mcp":{"servers":["imp-phone"]},"phone":{"contacts":[{"id":"office","name":"Office","uri":"sip:office@example.com"}]}}'
```

Imp prefixes MCP tools with the server id, so the model sees `imp-phone__phone_call` and `imp-phone__phone_hangup`. Calls are limited to the configured contacts. Use `phone.requestsDir` or `phone.controlDir` only when overriding the paths installed by the plugin.

## Skills

When skills are available from `paths.dataRoot/skills`, `agent.home/.skills`, configured `skills.paths`, or workspace `.skills`, Imp automatically enables `load_skill` for that turn.

The tool loads the selected skill's `SKILL.md` instructions and lists bundled resources. See [Agent Context](./agent-context.md) for skill discovery and context behavior.

## Apply Changes

Validate the config after changing tool access:

```sh
imp config validate
```

Reload or restart the endpoint that uses the agent so the new tool configuration is picked up.

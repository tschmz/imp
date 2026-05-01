# Agent Tools

Agent tools define what an agent may do outside normal text generation. Configure tools per agent so each agent gets only the access it needs.

The examples use `agents.default` for the agent with ID `default`.

## Start Read-Only

For a safer first setup, allow only read/search tools:

```sh
imp config set agents.default.tools '["read","grep","find","ls","pwd"]'
```

This lets the agent inspect files but not edit files or run shell commands.

## Built-in Tools

Common built-in tools are:

| Tool | Purpose |
| --- | --- |
| `read` | Read files |
| `grep` | Search file contents |
| `find` | Search for files by pattern |
| `ls` | List directory contents |
| `pwd` | Show the current tool working directory |
| `cd` | Change the working directory for later tool calls |
| `bash` | Run shell commands |
| `edit` | Edit existing files |
| `write` | Create or overwrite files |
| `update_plan` | Maintain a visible multi-step plan |

A broader coding-agent tool set might look like this:

```sh
imp config set agents.default.tools '["read","bash","edit","write","grep","find","ls","pwd","cd","update_plan"]'
```

Only enable `bash`, `edit`, and `write` for agents you trust with that level of access.

## Shell Environment

The `bash` tool uses the environment of the running Imp process. If an agent needs extra command search paths, set `workspace.shellPath`:

```sh
imp config set agents.default.workspace.shellPath '["/usr/local/bin","/usr/bin","/bin"]'
```

This affects the agent shell tool only. Provider credentials and service-wide variables still belong in the shell or service environment that starts Imp.

## MCP Servers

MCP servers are defined once at the top level and enabled per agent.

Define a server:

```sh
imp config set tools.mcp '{"inheritEnv":["GITHUB_TOKEN"],"servers":[{"id":"github","command":"github-mcp-server","args":["stdio"]}]}'
```

Enable it for an agent while keeping selected built-in tools:

```sh
imp config set agents.default.tools '{"builtIn":["read","bash"],"mcp":{"servers":["github"]}}'
```

Imp prefixes MCP tool names with the server ID to avoid collisions.

## Delegated Agents

An agent can expose another configured agent as a tool. The delegated agent runs with its own prompt, model, workspace, and tools.

```sh
imp config set agents.default.tools '{"builtIn":["read"],"agents":[{"agentId":"writer","toolName":"draft_copy","description":"Ask the writer agent for draft copy."}]}'
```

Delegated runs do not change the child agent's active session.

## Phone Tools

The `imp-phone` plugin provides phone tools through MCP. After installing the plugin, enable the `imp-phone` MCP server and configure contacts for the agent:

```sh
imp config set agents.default.tools '{"mcp":{"servers":["imp-phone"]},"phone":{"contacts":[{"id":"office","name":"Office","uri":"sip:office@example.com"}]}}'
```

Calls are limited to configured contacts.

## Skills

When skills are available, Imp automatically enables `load_skill` for that turn. See [Agent Context](./agent-context.md#skills) for skill discovery.

## Agent-Home Plugin Tools

Any plugin tool under `<agent.home>/.plugins/*` is added to that agent automatically at run time. You do not need to list those tools under `agents.<id>.tools`, and new agent-home plugin tools become available without restarting the daemon.

## Apply Changes

Validate and reload after changing tool access:

```sh
imp config validate --preflight
imp config reload
```

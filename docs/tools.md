# Built-in Tools

`imp` exposes a small set of built-in tools. Tools are disabled by default unless they are listed in
`agents[].tools` in the runtime config.

Use [Customizing agents](./customizing-agents.md) together with this page if you want to change tool access per agent.

The default config created by `imp init` enables these tools:

| Tool    | Purpose                                              |
|---------|------------------------------------------------------|
| `read`  | Read files from disk.                                |
| `bash`  | Run shell commands in the current working directory. |
| `edit`  | Edit existing files.                                 |
| `write` | Write new files or overwrite files.                  |
| `grep`  | Search file contents.                                |
| `find`  | Search for files by pattern.                         |
| `ls`    | List directory contents.                             |

Additional built-in tools are available when configured:

| Tool  | Purpose                                                                     |
|-------|-----------------------------------------------------------------------------|
| `pwd` | Show the current working directory used by filesystem and shell tools.      |
| `cd`  | Change the working directory used by subsequent filesystem and shell tools. |
| `phone_call` | Start an allowlisted SIP phone call through a configured local command. |
| `phone_hangup` | End the currently active imp-phone call through a control command. |

Configured delegated agent tools are also available when listed under `agents[].tools.agents`. Each entry creates one explicit tool such as `ask_ops` or a custom `toolName`, takes only `{ "input": string }`, and returns only the delegated agent's final text response.

Delegated runs are ephemeral: `imp` does not persist the child conversation or switch the child's active session. The child agent still runs with its own prompt, model, tools, and workspace. Delegation nesting is limited to one level.

When an agent has available skills from configured `skills.paths`, `paths.dataRoot/skills`, `agent.home/.skills`, or workspace `.skills`, `imp` also enables `load_skill` automatically for that turn. It loads the skill's `SKILL.md` instructions, reports the absolute skill directory, and lists bundled files under `scripts/` and `references/` without reading their contents.

## Bash PATH

The `bash` tool inherits the `PATH` from the running `imp` process and prepends the
`@mariozechner/pi-coding-agent` bin directory if it is not already present. That is the `PATH`
used when `workspace.shellPath` is not set.

If an agent sets `workspace.shellPath`, those entries are appended to that default `PATH` for
`bash` executions only. They do not replace the existing `PATH`, and they do not affect the
service-wide environment used by `imp` itself.

That means `workspace.shellPath` is agent-local runtime configuration, while service credentials and other daemon-wide variables belong in the process environment or, on Linux services, `service.env`.

## Phone Calls

`phone_call` is disabled unless both of these are true:

- `phone_call` is listed in `agents[].tools.builtIn`
- `agents[].tools.phone.contacts` defines at least one allowed contact

The tool never accepts arbitrary phone numbers from the model. The model can only choose one of the configured contact IDs.

Example with an `imp-phone` controller:

```json
{
  "agents": [
    {
      "id": "default",
      "tools": {
        "builtIn": ["read", "bash", "phone_call", "phone_hangup"],
        "phone": {
          "command": "node",
          "controlDir": "/home/thomas/.local/state/imp/runtime/plugins/imp-phone/requests/control",
          "args": [
            "/home/thomas/.local/state/imp/plugins/npm/node_modules/@tschmz/imp-phone/bin/request-call.mjs",
            "--requests-dir",
            "/home/thomas/.local/state/imp/runtime/plugins/imp-phone/requests",
            "--contact-id",
            "{contactId}",
            "--contact-name",
            "{contactName}",
            "--uri",
            "{uri}",
            "--purpose",
            "{purpose}",
            "--wait"
          ],
          "contacts": [
            {
              "id": "office",
              "name": "Office",
              "uri": "sip:+491234567@example.com"
            }
          ]
        }
      }
    }
  ]
}
```

Supported command placeholders:

- `{uri}`: the configured SIP URI
- `{contactId}`: the allowlist contact ID
- `{contactName}`: the display name
- `{purpose}`: the detailed call purpose produced by the agent

Optional fields:

- `cwd`: working directory for the phone command; relative paths resolve from the config file directory
- `env`: environment variables for the phone command
- `timeoutMs`: maximum command runtime before `imp` sends `SIGTERM`; when using `--wait`, keep this above the controller's registration and answer timeouts, or omit it
- `controlDir`: directory where `phone_hangup` writes control commands; when omitted, `imp` derives it from `--requests-dir` as `<requestsDir>/control`

When `command` and `args` are omitted, `imp` defaults to the legacy direct command `baresip -e "/dial {uri}"`. That mode only confirms that the command exited; use the `imp-phone` request helper with `--wait` when the agent should learn whether the call was answered, timed out, or failed.

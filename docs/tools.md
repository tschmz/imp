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

When an agent has available skills from configured `skills.paths`, `paths.dataRoot/skills`, `agent.home/.skills`, or workspace `.skills`, `imp` also enables `load_skill` automatically for that turn. It loads the skill's `SKILL.md` instructions, reports the absolute skill directory, and lists bundled files under `scripts/` and `references/` without reading their contents.

## Bash PATH

The `bash` tool inherits the `PATH` from the running `imp` process and prepends the
`@mariozechner/pi-coding-agent` bin directory if it is not already present. That is the `PATH`
used when `workspace.shellPath` is not set.

If an agent sets `workspace.shellPath`, those entries are appended to that default `PATH` for
`bash` executions only. They do not replace the existing `PATH`, and they do not affect the
service-wide environment used by `imp` itself.

That means `workspace.shellPath` is agent-local runtime configuration, while service credentials and other daemon-wide variables belong in the process environment or, on Linux services, `service.env`.

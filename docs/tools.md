# Built-in Tools

`imp` exposes a small set of built-in tools. Tools are disabled by default unless they are listed in
`agents[].tools` in the runtime config.

The default config created by `imp init` enables these tools:

| Tool    | Purpose                                                |
|---------|--------------------------------------------------------|
| `read`  | Read files from disk.                                  |
| `bash`  | Run shell commands in the current working directory.   |
| `edit`  | Edit existing files.                                   |
| `write` | Write new files or overwrite files.                    |
| `grep`  | Search file contents.                                  |
| `find`  | Search for files by pattern.                           |
| `ls`    | List directory contents.                               |

Additional built-in tools are available when configured:

| Tool  | Purpose                                                                    |
|-------|----------------------------------------------------------------------------|
| `pwd` | Show the current working directory used by filesystem and shell tools.     |
| `cd`  | Change the working directory used by subsequent filesystem and shell tools. |

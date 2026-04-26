import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCommandToolDefinitions } from "./command-tool.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("command plugin tools", () => {
  it("executes plugin command tools with JSON stdin and parses structured output", async () => {
    const root = await createTempDir();
    await writeFile(
      join(root, "tool.mjs"),
      `const chunks = [];\nfor await (const chunk of process.stdin) chunks.push(chunk);\nconst request = JSON.parse(Buffer.concat(chunks).toString("utf8"));\nprocess.stdout.write(JSON.stringify({\n  content: [{ type: "text", text: request.toolName + ":" + request.input.query }],\n  details: { pluginId: request.pluginId, cwd: process.cwd() }\n}));\n`,
      "utf8",
    );

    const [tool] = createCommandToolDefinitions([
      {
        pluginId: "notes",
        pluginRoot: root,
        manifest: {
          name: "search",
          description: "Search notes.",
          runner: {
            type: "command",
            command: process.execPath,
            args: ["./tool.mjs"],
          },
        },
      },
    ]);

    const result = await tool!.execute("call-1", { query: "imp" });

    expect(tool?.name).toBe("notes.search");
    expect(result).toEqual({
      content: [{ type: "text", text: "notes.search:imp" }],
      details: { pluginId: "notes", cwd: root },
    });
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-command-tool-test-"));
  tempDirs.push(path);
  return path;
}

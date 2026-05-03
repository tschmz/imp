import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBashTool } from "./bash-tool.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createBashTool", () => {
  it("executes commands in the configured working directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-bash-tool-"));
    tempDirs.push(root);
    const tool = createBashTool(root);

    const result = await tool.execute("1", { command: "pwd" });

    expect(textContent(result)).toBe(`${root}\n`);
  });

  it("returns combined stdout and stderr output", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-bash-tool-"));
    tempDirs.push(root);
    const tool = createBashTool(root);

    const result = await tool.execute("1", { command: "printf 'out\\n'; printf 'err\\n' >&2" });

    expect(textContent(result)).toBe("out\nerr\n");
  });

  it("throws with command output and exit code for failed commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-bash-tool-"));
    tempDirs.push(root);
    const tool = createBashTool(root);

    await expect(tool.execute("1", { command: "printf 'before failure'; exit 7" })).rejects.toThrow(
      "before failure\n\nCommand exited with code 7",
    );
  });

  it("passes spawn hook environment into the command", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-bash-tool-"));
    tempDirs.push(root);
    const tool = createBashTool(root, {
      spawnHook: (context) => ({
        ...context,
        env: {
          ...context.env,
          IMP_BASH_TOOL_TEST: "ok",
        },
      }),
    });

    const result = await tool.execute("1", { command: "printf '%s' \"$IMP_BASH_TOOL_TEST\"" });

    expect(textContent(result)).toBe("ok");
  });

  it("truncates large output and stores the full output in a temp file", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-bash-tool-"));
    tempDirs.push(root);
    const tool = createBashTool(root);

    const result = await tool.execute("1", { command: "python3 - <<'PY'\nprint('x' * 60000)\nPY" });

    expect(result.details).toMatchObject({ truncation: { truncated: true } });
    const fullOutputPath = (result.details as { fullOutputPath?: string } | undefined)?.fullOutputPath;
    expect(fullOutputPath).toBeDefined();
    expect(await readFile(fullOutputPath!, "utf8")).toContain("x".repeat(60000));
    await rm(fullOutputPath!, { force: true });
  });
});

function textContent(result: Awaited<ReturnType<ReturnType<typeof createBashTool>["execute"]>>): string {
  return result.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
}

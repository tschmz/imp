import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAttachFileTool, createAttachmentCollector } from "./attach-file-tool.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("attach_file tool", () => {
  it("queues an exported attachment without exposing file links in tool text", async () => {
    const root = await createTempDir();
    const workspace = join(root, "workspace");
    const dataRoot = join(root, "data");
    const sourcePath = join(workspace, "report.md");
    await mkdir(workspace, { recursive: true });
    await writeFile(sourcePath, "report", "utf8");

    const collector = createAttachmentCollector();
    const tool = createAttachFileTool(workspace, collector, {
      dataRoot,
      now: () => "2026-05-02T22:51:53.000Z",
      conversation: {
        state: {
          conversation: {
            transport: "telegram",
            externalId: "42",
            sessionId: "session-1",
          },
          agentId: "agent-1",
          createdAt: "2026-05-02T22:51:00.000Z",
          updatedAt: "2026-05-02T22:51:00.000Z",
          version: 1,
        },
        messages: [],
      },
    });

    const result = await tool.execute("call-1", {
      path: "report.md",
      fileName: "report.md",
      mimeType: "text/markdown",
    });

    const toolText = result.content.map((item) => item.type === "text" ? item.text : "").join("\n");
    expect(toolText).toContain("Queued attachment: report.md");
    expect(toolText).not.toContain("file://");
    expect(toolText).not.toContain(dataRoot);
    expect(toolText).not.toContain(sourcePath);
    expect(collector.list()).toHaveLength(1);
    const attachment = collector.list()[0];
    expect(attachment).toMatchObject({
      kind: "file",
      fileName: "report.md",
      mimeType: "text/markdown",
    });
    expect(attachment?.path).toContain(join(dataRoot, "exports", "agent-1", "session-1", "attachments"));
    await expect(readFile(attachment!.path, "utf8")).resolves.toBe("report");
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-attach-file-tool-test-"));
  tempDirs.push(path);
  return path;
}

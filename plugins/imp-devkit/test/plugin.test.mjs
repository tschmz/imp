import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerPlugin } from "../plugin.mjs";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("imp-devkit plugin", () => {
  it("describes an Imp plugin manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-devkit-test-"));
    tempDirs.push(root);
    const manifestPath = join(root, "imp-plugin.json");
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      id: "notes",
      name: "Notes",
      version: "0.1.0",
      runtime: { module: "./plugin.mjs" },
      tools: [{ name: "search", description: "Search notes.", runner: { type: "command", command: "node" } }],
      agents: [{ id: "assistant", model: { provider: "openai", modelId: "gpt-5.4" } }],
      skills: [{ path: "./skills" }]
    }), "utf8");

    const registration = registerPlugin({ plugin: { id: "imp-devkit", rootDir: process.cwd() } });
    const tool = registration.tools.find((candidate) => candidate.name === "describeManifest");
    const result = await tool.execute("call-1", { path: manifestPath });

    expect(result.content[0].text).toContain("Plugin: notes");
    expect(result.content[0].text).toContain("notes__search");
    expect(result.content[0].text).toContain("notes.assistant");
    expect(result.content[0].text).toContain("runtime.module runs trusted JS");
    expect(result.details).toMatchObject({
      pluginId: "notes",
      capabilityCounts: {
        agents: 1,
        commandTools: 1,
        skills: 1,
        hasRuntimeModule: true
      }
    });
  });
});

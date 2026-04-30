import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { registerPlugin } from "../plugin.mjs";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("imp-agents plugin", () => {
  it("tells Cody to store workspace memory under agent.home", async () => {
    const prompt = await readFile(new URL("../prompts/cody.md", import.meta.url), "utf8");

    expect(prompt).toContain("{{agent.home}}/MEMORY.md");
    expect(prompt).toContain("Current repo: /absolute/path/to/repo");
    expect(prompt).toContain("agent-home Markdown instructions");
  });

  it("includes Telegram-specific output guidance in Cody's prompt", async () => {
    const prompt = await readFile(new URL("../prompts/cody.md", import.meta.url), "utf8");

    expect(prompt).toContain('{{#if (eq output.reply.channel.kind "telegram")}}');
  });

  it("configures Cody with bundled skills", async () => {
    const manifest = JSON.parse(await readFile(new URL("../plugin.json", import.meta.url), "utf8"));
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    const administrationSkill = await readFile(
      new URL("../skills/imp-administration/SKILL.md", import.meta.url),
      "utf8",
    );
    const releaseSkill = await readFile(
      new URL("../skills/release-preparation/SKILL.md", import.meta.url),
      "utf8",
    );
    const cody = manifest.agents.find((agent) => agent.id === "cody");

    expect(cody.skills.paths).toEqual(["./skills"]);
    expect(cody.tools.builtIn).toContain("load_skill");
    expect(packageJson.files).toContain("skills");
    expect(administrationSkill).toContain("name: imp-administration");
    expect(administrationSkill).toContain("Use only `imp ...` commands for Imp administration.");
    expect(releaseSkill).toContain("name: release-preparation");
    expect(releaseSkill).toContain("Find The Existing Release Pattern");
    expect(releaseSkill).toContain("If there is no prior release pattern");
  });

  it("creates a workspace snapshot for coding-agent orientation", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-agents-test-"));
    tempDirs.push(root);
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "notes",
      version: "0.1.0",
      type: "module",
      scripts: {
        test: "vitest run",
        check: "tsc --noEmit",
      },
      dependencies: {
        zod: "^4.0.0",
      },
    }), "utf8");
    await writeFile(join(root, "AGENTS.md"), "# Workspace Instructions\n\nUse focused tests.", "utf8");
    await mkdir(join(root, "plugins", "notes"), { recursive: true });
    await writeFile(join(root, "plugins", "notes", "plugin.json"), JSON.stringify({
      schemaVersion: 1,
      id: "notes",
      name: "Notes",
      version: "0.1.0",
    }), "utf8");

    const registration = registerPlugin({ plugin: { id: "imp-agents", rootDir: process.cwd() } });
    const tool = registration.tools.find((candidate) => candidate.name === "workspaceSnapshot");
    const result = await tool.execute("call-1", { path: root, maxEntries: 20 });

    expect(result.content[0].text).toContain("Workspace Snapshot");
    expect(result.content[0].text).toContain("Package: notes@0.1.0");
    expect(result.content[0].text).toContain("scripts=check, test");
    expect(result.content[0].text).toContain("AGENTS.md: # Workspace Instructions");
    expect(result.content[0].text).toContain("plugins/notes/plugin.json");
    expect(result.details).toMatchObject({
      targetPath: root,
      projectRoot: root,
      packageJson: {
        name: "notes",
        scripts: ["check", "test"],
        dependencyCount: 1,
      },
      agentsFiles: [
        expect.objectContaining({ path: "AGENTS.md" }),
      ],
      pluginManifests: ["plugins/notes/plugin.json"],
    });
  });
});

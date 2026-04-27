import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRuntimePlugins } from "./plugin-runtime.js";
import type { AppConfig } from "./types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("loadRuntimePlugins", () => {
  it("assigns a default home to plugin agents", async () => {
    const root = await createTempDir();
    const dataRoot = join(root, "state");
    const pluginRoot = join(dataRoot, "plugins", "imp-devkit");
    await writePluginManifest(pluginRoot, {
      schemaVersion: 1,
      id: "imp-devkit",
      name: "Imp DevKit",
      version: "0.1.0",
      agents: [
        {
          id: "developer",
          prompt: { base: { text: "Developer" } },
        },
      ],
    });

    const result = await loadRuntimePlugins(createAppConfig(dataRoot), join(root, "config"));

    expect(result.agents[0]).toMatchObject({
      id: "imp-devkit.developer",
      home: join(dataRoot, "agents", "imp-devkit.developer"),
    });
  });

  it("resolves explicit plugin agent home paths relative to the plugin root", async () => {
    const root = await createTempDir();
    const dataRoot = join(root, "state");
    const pluginRoot = join(dataRoot, "plugins", "imp-devkit");
    await writePluginManifest(pluginRoot, {
      schemaVersion: 1,
      id: "imp-devkit",
      name: "Imp DevKit",
      version: "0.1.0",
      agents: [
        {
          id: "developer",
          home: "./agents/developer",
          prompt: { base: { text: "Developer" } },
        },
      ],
    });

    const result = await loadRuntimePlugins(createAppConfig(dataRoot), join(root, "config"));

    expect(result.agents[0]).toMatchObject({
      id: "imp-devkit.developer",
      home: join(pluginRoot, "agents", "developer"),
    });
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-plugin-runtime-test-"));
  tempDirs.push(path);
  return path;
}

async function writePluginManifest(pluginRoot: string, manifest: unknown): Promise<void> {
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(join(pluginRoot, "imp-plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function createAppConfig(dataRoot: string): AppConfig {
  return {
    instance: { name: "test" },
    paths: { dataRoot },
    defaults: {
      agentId: "default",
      model: { provider: "openai", modelId: "gpt-5.4" },
    },
    agents: [
      {
        id: "default",
        prompt: { base: { text: "Default" } },
      },
    ],
    endpoints: [],
  };
}

import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentDefinition } from "../../domain/agent.js";
import { prepareAgentHomeDirectories } from "./prepare-runtime-filesystem.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("prepareAgentHomeDirectories", () => {
  it("creates configured agent home directories", async () => {
    const root = await createTempDir();
    const agentHome = join(root, "agents", "imp-devkit.developer");

    await prepareAgentHomeDirectories([
      createAgent({ id: "imp-devkit.developer", home: agentHome }),
      createAgent({ id: "no-home" }),
    ]);

    await expect(access(agentHome)).resolves.toBeUndefined();
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-runtime-filesystem-test-"));
  tempDirs.push(path);
  return path;
}

function createAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "default",
    name: "Default",
    prompt: {
      base: { text: "You are concise." },
    },
    model: {
      provider: "test",
      modelId: "stub",
    },
    tools: [],
    extensions: [],
    ...overrides,
  };
}

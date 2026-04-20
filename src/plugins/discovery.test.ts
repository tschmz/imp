import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverPluginManifests } from "./discovery.js";

describe("discoverPluginManifests", () => {
  it("discovers valid plugin manifests below a plugin root", async () => {
    const root = await createTempRoot();
    await mkdir(join(root, "imp-voice"), { recursive: true });
    await writeFile(
      join(root, "imp-voice", "plugin.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "imp-voice",
        name: "imp Voice",
        version: "0.1.0",
        endpoints: [
          {
            id: "audio-ingress",
            response: {
              type: "outbox",
              replyChannel: {
                kind: "audio",
              },
            },
          },
        ],
      }),
      "utf8",
    );

    const result = await discoverPluginManifests([root]);

    expect(result.issues).toEqual([]);
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]).toMatchObject({
      rootDir: join(root, "imp-voice"),
      manifestPath: join(root, "imp-voice", "plugin.json"),
      manifestHash: expect.stringMatching(/^sha256:/),
      manifest: {
        id: "imp-voice",
        name: "imp Voice",
      },
    });
  });

  it("reports invalid manifests without failing the full discovery run", async () => {
    const root = await createTempRoot();
    await mkdir(join(root, "broken"), { recursive: true });
    await writeFile(
      join(root, "broken", "plugin.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "broken",
        version: "0.1.0",
      }),
      "utf8",
    );

    const result = await discoverPluginManifests([root]);

    expect(result.plugins).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        path: join(root, "broken", "plugin.json"),
        message: expect.stringContaining("name"),
      }),
    ]);
  });
});

let tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "imp-plugin-discovery-test-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.map((path) => rm(path, { recursive: true, force: true })));
  tempRoots = [];
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeConfig } from "../lib/config.mjs";
import { writeIngressEvent } from "../lib/events.mjs";

describe("imp-voice events", () => {
  it("writes imp plugin ingress events atomically", async () => {
    const root = await createTempRoot();
    const config = normalizeConfig(
      {
        runtimeDir: join(root, "runtime"),
        conversationId: "imp-voice",
        userId: "imp-voice",
      },
      root,
    );

    const path = await writeIngressEvent(config, {
      id: "manual-1",
      text: "Are you there?",
      metadata: {
        mode: "test",
      },
    });

    const payload = JSON.parse(await readFile(path, "utf8"));
    expect(payload).toMatchObject({
      schemaVersion: 1,
      id: "manual-1",
      conversationId: "imp-voice",
      userId: "imp-voice",
      text: "Are you there?",
      metadata: {
        source: "imp-voice",
        mode: "test",
      },
    });
  });
});

let tempRoots = [];

async function createTempRoot() {
  const root = await mkdtemp(join(tmpdir(), "imp-voice-events-test-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.map((path) => rm(path, { recursive: true, force: true })));
  tempRoots = [];
});

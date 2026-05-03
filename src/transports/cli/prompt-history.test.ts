import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addCliPromptHistoryEntry,
  createCliPromptHistoryStore,
  getCliPromptHistoryPath,
} from "./prompt-history.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("CLI prompt history", () => {
  it("stores prompt history per agent", async () => {
    const root = await createTempDir();
    const store = createCliPromptHistoryStore(root);

    await store.add("default", "first");
    await store.add("ops/agent", "second");

    expect(await store.read("default")).toEqual(["first"]);
    expect(await store.read("ops/agent")).toEqual(["second"]);
    expect(getCliPromptHistoryPath(root, "ops/agent")).toBe(
      join(root, "sessions", "ops_agent", "prompt-history.json"),
    );
  });

  it("keeps newest prompts first and moves repeated prompts to the front", async () => {
    const root = await createTempDir();
    const store = createCliPromptHistoryStore(root);

    await store.add("default", "first");
    await store.add("default", "second");
    await store.add("default", "first");

    expect(await store.read("default")).toEqual(["first", "second"]);
  });

  it("deduplicates prompts loaded from existing history files", async () => {
    const root = await createTempDir();
    const store = createCliPromptHistoryStore(root);
    const path = getCliPromptHistoryPath(root, "default");

    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        agentId: "default",
        entries: ["first", " second ", "first", "", 42, "second", "third"],
      }),
      "utf8",
    );

    await expect(store.read("default")).resolves.toEqual(["first", "second", "third"]);
    await expect(store.add("default", "second")).resolves.toEqual(["second", "first", "third"]);
  });

  it("limits stored prompt history", () => {
    const entries = Array.from({ length: 100 }, (_, index) => `entry ${index}`);

    expect(addCliPromptHistoryEntry(entries, "new")).toHaveLength(100);
    expect(addCliPromptHistoryEntry(entries, "new")[0]).toBe("new");
    expect(addCliPromptHistoryEntry(entries, "new").at(-1)).toBe("entry 98");
  });

  it("writes JSON history files", async () => {
    const root = await createTempDir();
    const store = createCliPromptHistoryStore(root);
    const path = getCliPromptHistoryPath(root, "default");

    await store.add("default", "hello");

    await expect(readFile(path, "utf8")).resolves.toContain('"entries"');
  });

  it("recovers from invalid history files", async () => {
    const root = await createTempDir();
    const store = createCliPromptHistoryStore(root);
    const path = getCliPromptHistoryPath(root, "default");

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{not-json", "utf8");

    await expect(store.read("default")).resolves.toEqual([]);
    await expect(store.add("default", "hello")).resolves.toEqual(["hello"]);
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-cli-history-test-"));
  tempDirs.push(path);
  return path;
}

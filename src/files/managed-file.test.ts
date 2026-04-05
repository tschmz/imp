import { chmod, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertManagedFileCanBeWritten, writeManagedFile } from "./managed-file.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("managed file", () => {
  it("writes a new file with the configured mode", async () => {
    const root = await createTempDir();
    const path = join(root, "config.json");

    await writeManagedFile({
      path,
      resourceLabel: "Config file",
      content: "{\n}\n",
    });

    await expect(readFile(path, "utf8")).resolves.toBe("{\n}\n");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("fails early when a file exists without force", async () => {
    const root = await createTempDir();
    const path = join(root, "config.json");

    await writeManagedFile({
      path,
      resourceLabel: "Config file",
      content: "{}\n",
    });

    await expect(
      assertManagedFileCanBeWritten({
        path,
        resourceLabel: "Config file",
      }),
    ).rejects.toThrowError(`Config file already exists: ${path}\nRe-run with --force to overwrite.`);
  });

  it("allows overwriting with force", async () => {
    const root = await createTempDir();
    const path = join(root, "config.json");

    await writeManagedFile({
      path,
      resourceLabel: "Config file",
      content: "{}\n",
    });

    await expect(
      assertManagedFileCanBeWritten({
        path,
        resourceLabel: "Config file",
        force: true,
      }),
    ).resolves.toBe(path);
  });

  it("creates a timestamped backup when overwriting with force", async () => {
    const root = await createTempDir();
    const path = join(root, "config.json");
    const backupPath = `${path}.2026-04-05T18-15-00.000Z.bak`;

    await writeManagedFile({
      path,
      resourceLabel: "Config file",
      content: "{\n  \"version\": 1\n}\n",
    });
    await chmod(path, 0o644);

    await writeManagedFile({
      path,
      resourceLabel: "Config file",
      content: "{\n  \"version\": 2\n}\n",
      force: true,
      now: new Date("2026-04-05T18:15:00.000Z"),
    });

    await expect(readFile(backupPath, "utf8")).resolves.toBe("{\n  \"version\": 1\n}\n");
    await expect(readFile(path, "utf8")).resolves.toBe("{\n  \"version\": 2\n}\n");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(backupPath)).mode & 0o777).toBe(0o600);
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-managed-file-test-"));
  tempDirs.push(path);
  return path;
}

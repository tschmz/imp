import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTarArchive, extractTarArchive } from "./tar-archive.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("tar archive", () => {
  it("creates and extracts a tar archive with files and nested directories", async () => {
    const root = await createTempDir();
    const sourceDir = join(root, "source");
    const extractDir = join(root, "extract");
    const archivePath = join(root, "backup.tar");

    await writeTextFile(join(sourceDir, "manifest.json"), "{\n  \"version\": 1\n}\n");
    await writeTextFile(join(sourceDir, "nested", "prompt.md"), "system prompt\n");

    await createTarArchive(sourceDir, archivePath);
    await extractTarArchive(archivePath, extractDir);

    await expect(readFile(join(extractDir, "manifest.json"), "utf8")).resolves.toContain('"version": 1');
    await expect(readFile(join(extractDir, "nested", "prompt.md"), "utf8")).resolves.toBe("system prompt\n");
  });

  it("rejects a tar archive with an invalid header checksum", async () => {
    const root = await createTempDir();
    const sourceDir = join(root, "source");
    const archivePath = join(root, "backup.tar");
    const extractDir = join(root, "extract");

    await writeTextFile(join(sourceDir, "file.txt"), "hello\n");
    await createTarArchive(sourceDir, archivePath);

    const archive = await readFile(archivePath);
    archive[0] = "X".charCodeAt(0);
    await writeFile(archivePath, archive);

    await expect(extractTarArchive(archivePath, extractDir)).rejects.toThrow(
      "Invalid backup archive: tar header checksum mismatch",
    );
  });

  it("rejects a tar archive with a truncated file entry", async () => {
    const root = await createTempDir();
    const sourceDir = join(root, "source");
    const archivePath = join(root, "backup.tar");
    const extractDir = join(root, "extract");

    await writeTextFile(join(sourceDir, "file.txt"), "hello\n");
    await createTarArchive(sourceDir, archivePath);

    const archive = await readFile(archivePath);
    await writeFile(archivePath, archive.subarray(0, 515));

    await expect(extractTarArchive(archivePath, extractDir)).rejects.toThrow(
      "Invalid backup archive: truncated tar entry for file.txt",
    );
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-tar-test-"));
  tempDirs.push(path);
  return path;
}

async function writeTextFile(path: string, content: string): Promise<void> {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(dirname(path), { recursive: true }));
  await writeFile(path, content, "utf8");
}

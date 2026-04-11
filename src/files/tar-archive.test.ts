import { mkdtemp, open, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTarArchive, extractTarArchive } from "./tar-archive.js";

const tempDirs: string[] = [];
const tarBlockSize = 512;

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

  it("streams large files without loading the full content in memory", async () => {
    const root = await createTempDir();
    const sourceDir = join(root, "source");
    const extractDir = join(root, "extract");
    const archivePath = join(root, "backup.tar");
    const largeFilePath = join(sourceDir, "large.bin");

    await writeRepeatedPatternFile(largeFilePath, 110 * 1024 * 1024, 1024 * 1024);

    await createTarArchive(sourceDir, archivePath);
    await extractTarArchive(archivePath, extractDir);

    const extractedStats = await stat(join(extractDir, "large.bin"));
    expect(extractedStats.size).toBe(110 * 1024 * 1024);

    const extractedHandle = await open(join(extractDir, "large.bin"), "r");
    try {
      const head = Buffer.alloc(16);
      const tail = Buffer.alloc(16);
      await extractedHandle.read(head, 0, head.length, 0);
      await extractedHandle.read(tail, 0, tail.length, extractedStats.size - tail.length);

      expect(head.toString("ascii")).toBe("0123456789abcdef");
      expect(tail.toString("ascii")).toBe("0123456789abcdef");
    } finally {
      await extractedHandle.close();
    }
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

  it("rejects entries larger than the configured maximum entry size", async () => {
    const root = await createTempDir();
    const sourceDir = join(root, "source");
    const archivePath = join(root, "backup.tar");
    const extractDir = join(root, "extract");

    await writeTextFile(join(sourceDir, "big.txt"), "x".repeat(2048));
    await createTarArchive(sourceDir, archivePath);

    await expect(
      extractTarArchive(archivePath, extractDir, {
        maxEntrySizeBytes: 1024,
      }),
    ).rejects.toThrow("Invalid backup archive: tar entry too large for big.txt");
  });

  it("extracts a file from a directory entry without execute bits", async () => {
    const root = await createTempDir();
    const archivePath = join(root, "backup.tar");
    const extractDir = join(root, "extract");

    await writeFile(
      archivePath,
      buildTarArchive([
        { path: "dir/", type: "directory", mode: 0o644 },
        { path: "dir/file.txt", type: "file", mode: 0o600, content: "hello\n" },
      ]),
    );

    await expect(extractTarArchive(archivePath, extractDir)).resolves.toBeUndefined();
    await expect(readFile(join(extractDir, "dir", "file.txt"), "utf8")).resolves.toBe("hello\n");

    const directoryStat = await stat(join(extractDir, "dir"));
    expect(directoryStat.mode & 0o777).toBe(0o744);
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

async function writeRepeatedPatternFile(path: string, totalBytes: number, chunkBytes: number): Promise<void> {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(dirname(path), { recursive: true }));

  const writer = await open(path, "w", 0o600);
  const basePattern = Buffer.from("0123456789abcdef", "ascii");
  const chunk = Buffer.allocUnsafe(chunkBytes);
  for (let offset = 0; offset < chunk.length; offset += basePattern.length) {
    basePattern.copy(chunk, offset, 0, Math.min(basePattern.length, chunk.length - offset));
  }

  try {
    let written = 0;
    while (written < totalBytes) {
      const remaining = totalBytes - written;
      const nextChunk = remaining >= chunk.length ? chunk : chunk.subarray(0, remaining);
      await writer.write(nextChunk);
      written += nextChunk.length;
    }
  } finally {
    await writer.close();
  }
}

function buildTarArchive(entries: Array<{ path: string; type: "file" | "directory"; mode: number; content?: string }>): Buffer {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const content = entry.type === "file" ? Buffer.from(entry.content ?? "", "utf8") : Buffer.alloc(0);
    blocks.push(buildTarHeader(entry.path, entry.type, entry.mode, content.byteLength));

    if (entry.type === "file") {
      blocks.push(content);
      const padding = getPaddingSize(content.byteLength);
      if (padding > 0) {
        blocks.push(Buffer.alloc(padding, 0));
      }
    }
  }

  blocks.push(Buffer.alloc(tarBlockSize, 0), Buffer.alloc(tarBlockSize, 0));
  return Buffer.concat(blocks);
}

function buildTarHeader(path: string, type: "file" | "directory", mode: number, size: number): Buffer {
  const header = Buffer.alloc(tarBlockSize, 0);

  writeStringField(header, 0, 100, path);
  writeOctalField(header, 100, 8, mode);
  writeOctalField(header, 108, 8, 0);
  writeOctalField(header, 116, 8, 0);
  writeOctalField(header, 124, 12, size);
  writeOctalField(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = type === "directory" ? "5".charCodeAt(0) : "0".charCodeAt(0);
  writeStringField(header, 257, 6, "ustar");
  writeStringField(header, 263, 2, "00");
  writeStringField(header, 265, 32, "root");
  writeStringField(header, 297, 32, "root");

  writeChecksumField(header, calculateChecksum(header));
  return header;
}

function writeStringField(buffer: Buffer, offset: number, length: number, value: string): void {
  Buffer.from(value, "utf8").copy(buffer, offset, 0, length);
}

function writeOctalField(buffer: Buffer, offset: number, length: number, value: number): void {
  const encoded = Buffer.from(value.toString(8).padStart(length - 1, "0").slice(-(length - 1)), "ascii");
  encoded.copy(buffer, offset);
  buffer[offset + length - 1] = 0;
}

function writeChecksumField(buffer: Buffer, checksum: number): void {
  const encoded = Buffer.from(checksum.toString(8).padStart(6, "0"), "ascii");
  encoded.copy(buffer, 148);
  buffer[154] = 0;
  buffer[155] = 0x20;
}

function calculateChecksum(buffer: Buffer): number {
  let sum = 0;

  for (const byte of buffer) {
    sum += byte;
  }

  return sum;
}

function getPaddingSize(size: number): number {
  const remainder = size % tarBlockSize;
  return remainder === 0 ? 0 : tarBlockSize - remainder;
}

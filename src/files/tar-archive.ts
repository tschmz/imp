import { createReadStream } from "node:fs";
import { chmod, mkdir, open, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";

const tarBlockSize = 512;
const zeroBlock = Buffer.alloc(tarBlockSize, 0);
const defaultReadChunkSize = 64 * 1024;

interface TarEntry {
  path: string;
  type: "file" | "directory";
  mode: number;
  size: number;
  mtime: number;
}

interface ExtractTarArchiveOptions {
  maxEntrySizeBytes?: number;
  maxEntries?: number;
}

const defaultExtractLimits: Required<ExtractTarArchiveOptions> = {
  maxEntrySizeBytes: 512 * 1024 * 1024,
  maxEntries: 10_000,
};

export async function createTarArchive(sourceDir: string, outputPath: string): Promise<void> {
  const archive = await open(outputPath, "w", 0o600);

  try {
    for (const entry of await listTarEntries(sourceDir)) {
      await archive.write(buildTarHeader(entry));

      if (entry.type === "file") {
        const sourcePath = join(sourceDir, entry.path);
        await writeFileContentToArchive(archive, sourcePath, entry.size);
      }
    }

    await archive.write(zeroBlock);
    await archive.write(zeroBlock);
    await archive.chmod(0o600);
  } finally {
    await archive.close();
  }
}

export async function extractTarArchive(
  archivePath: string,
  outputDir: string,
  options: ExtractTarArchiveOptions = {},
): Promise<void> {
  const archive = await open(archivePath, "r");
  const reader = new TarArchiveReader(archive);
  const directoryModes = new Map<string, number>();
  const limits = { ...defaultExtractLimits, ...options };
  let entries = 0;

  try {
    while (true) {
      const header = await reader.readBlock();
      if (header === null) {
        break;
      }

      if (isZeroBlock(header)) {
        break;
      }

      entries += 1;
      if (entries > limits.maxEntries) {
        throw new Error(`Invalid backup archive: entry count exceeds limit (${limits.maxEntries})`);
      }

      assertHeaderChecksum(header);
      const entry = parseTarHeader(header);
      const targetPath = resolve(outputDir, entry.path);
      assertArchivePath(targetPath, outputDir);

      if (entry.size > limits.maxEntrySizeBytes) {
        throw new Error(
          `Invalid backup archive: tar entry too large for ${entry.path} (${entry.size} bytes exceeds ${limits.maxEntrySizeBytes})`,
        );
      }

      if (entry.type === "directory") {
        await mkdir(targetPath, { recursive: true, mode: 0o700 });
        directoryModes.set(targetPath, normalizeExtractedDirectoryMode(entry.mode));
        continue;
      }

      await mkdir(dirname(targetPath), { recursive: true });
      await streamEntryContentToFile(reader, targetPath, entry);
      await reader.skipPadding(entry.size);
    }
  } finally {
    await archive.close();
  }

  for (const [path, mode] of [...directoryModes.entries()].sort(
    ([left], [right]) => right.length - left.length,
  )) {
    await chmod(path, mode);
  }
}

async function listTarEntries(root: string, currentDir = root): Promise<TarEntry[]> {
  const dirEntries = await readdir(currentDir, { withFileTypes: true });
  const entries: TarEntry[] = [];

  for (const dirEntry of dirEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(currentDir, dirEntry.name);
    const relativePath = toTarPath(relative(root, absolutePath));
    const fileStat = await stat(absolutePath);

    if (dirEntry.isDirectory()) {
      entries.push({
        path: `${relativePath}/`,
        type: "directory",
        mode: fileStat.mode & 0o777,
        size: 0,
        mtime: Math.floor(fileStat.mtimeMs / 1000),
      });
      entries.push(...(await listTarEntries(root, absolutePath)));
      continue;
    }

    if (dirEntry.isFile()) {
      entries.push({
        path: relativePath,
        type: "file",
        mode: fileStat.mode & 0o777,
        size: fileStat.size,
        mtime: Math.floor(fileStat.mtimeMs / 1000),
      });
    }
  }

  return entries;
}

function buildTarHeader(entry: TarEntry): Buffer {
  const header = Buffer.alloc(tarBlockSize, 0);
  const { name, prefix } = splitTarPath(entry.path);

  writeStringField(header, 0, 100, name);
  writeOctalField(header, 100, 8, entry.mode);
  writeOctalField(header, 108, 8, 0);
  writeOctalField(header, 116, 8, 0);
  writeOctalField(header, 124, 12, entry.size);
  writeOctalField(header, 136, 12, entry.mtime);
  header.fill(0x20, 148, 156);
  header[156] = entry.type === "directory" ? "5".charCodeAt(0) : "0".charCodeAt(0);
  writeStringField(header, 257, 6, "ustar");
  writeStringField(header, 263, 2, "00");
  writeStringField(header, 265, 32, "root");
  writeStringField(header, 297, 32, "root");
  writeStringField(header, 345, 155, prefix);

  const checksum = calculateChecksum(header);
  writeChecksumField(header, checksum);

  return header;
}

function parseTarHeader(header: Buffer): TarEntry {
  const name = readStringField(header, 0, 100);
  const prefix = readStringField(header, 345, 155);
  const path = prefix ? `${prefix}/${name}` : name;
  const typeFlag = String.fromCharCode(header[156] || "0".charCodeAt(0));
  const type = typeFlag === "5" ? "directory" : "file";

  return {
    path,
    type,
    mode: readOctalField(header, 100, 8) || 0o600,
    size: readOctalField(header, 124, 12),
    mtime: readOctalField(header, 136, 12),
  };
}

function splitTarPath(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path) <= 100) {
    return { name: path, prefix: "" };
  }

  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  const segments = normalized.split("/");

  for (let index = segments.length - 1; index > 0; index -= 1) {
    const prefix = segments.slice(0, index).join("/");
    const name = segments.slice(index).join("/");
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) {
      return {
        name: path.endsWith("/") ? `${name}/` : name,
        prefix,
      };
    }
  }

  throw new Error(`Archive entry path is too long for tar format: ${path}`);
}

function writeStringField(buffer: Buffer, offset: number, length: number, value: string): void {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength > length) {
    throw new Error(`Value does not fit in tar header field: ${value}`);
  }

  encoded.copy(buffer, offset);
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

function readStringField(buffer: Buffer, offset: number, length: number): string {
  return buffer
    .subarray(offset, offset + length)
    .toString("utf8")
    .replace(/\0.*$/, "");
}

function readOctalField(buffer: Buffer, offset: number, length: number): number {
  const raw = buffer
    .subarray(offset, offset + length)
    .toString("ascii")
    .replace(/\0.*$/, "")
    .trim();

  if (!raw) {
    return 0;
  }

  return Number.parseInt(raw, 8);
}

function calculateChecksum(buffer: Buffer): number {
  let sum = 0;
  for (const byte of buffer) {
    sum += byte;
  }
  return sum;
}

function assertHeaderChecksum(header: Buffer): void {
  const expected = readOctalField(header, 148, 8);
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  const actual = calculateChecksum(copy);

  if (expected !== actual) {
    throw new Error("Invalid backup archive: tar header checksum mismatch");
  }
}

function isZeroBlock(block: Buffer): boolean {
  return block.equals(zeroBlock);
}

function getPaddingSize(size: number): number {
  const remainder = size % tarBlockSize;
  return remainder === 0 ? 0 : tarBlockSize - remainder;
}

function normalizeExtractedDirectoryMode(mode: number): number {
  return mode | 0o100;
}

function toTarPath(path: string): string {
  return path.split(sep).join(posix.sep);
}

function assertArchivePath(targetPath: string, outputDir: string): void {
  const normalizedOutputDir = resolve(outputDir);
  if (
    targetPath !== normalizedOutputDir &&
    !targetPath.startsWith(`${normalizedOutputDir}${sep}`)
  ) {
    throw new Error("Invalid backup archive: contains path traversal entry");
  }
}

async function writeFileContentToArchive(
  archive: Awaited<ReturnType<typeof open>>,
  sourcePath: string,
  size: number,
): Promise<void> {
  for await (const chunk of createReadStream(sourcePath)) {
    await archive.write(chunk);
  }

  await writePadding(archive, size);
}

async function writePadding(
  archive: Awaited<ReturnType<typeof open>>,
  size: number,
): Promise<void> {
  const paddingSize = getPaddingSize(size);
  if (paddingSize > 0) {
    await archive.write(Buffer.alloc(paddingSize, 0));
  }
}

async function streamEntryContentToFile(
  reader: TarArchiveReader,
  targetPath: string,
  entry: TarEntry,
): Promise<void> {
  if (entry.size === 0) {
    await writeFile(targetPath, Buffer.alloc(0), { mode: entry.mode });
    return;
  }

  const output = await open(targetPath, "w", entry.mode);

  try {
    let remaining = entry.size;
    while (remaining > 0) {
      const chunkSize = Math.min(remaining, defaultReadChunkSize);
      const chunk = await reader.readExact(chunkSize, `Invalid backup archive: truncated tar entry for ${entry.path}`);
      let writeOffset = 0;
      while (writeOffset < chunk.byteLength) {
        const { bytesWritten } = await output.write(chunk, writeOffset, chunk.byteLength - writeOffset);
        if (bytesWritten === 0) {
          throw new Error(`Failed to extract tar entry: short write for ${entry.path}`);
        }
        writeOffset += bytesWritten;
      }
      remaining -= chunk.byteLength;
    }
  } finally {
    await output.close();
  }
}

class TarArchiveReader {
  private offset = 0;

  constructor(private readonly archive: Awaited<ReturnType<typeof open>>) {}

  async readBlock(): Promise<Buffer | null> {
    const block = await this.readChunk(tarBlockSize);
    if (block.byteLength === 0) {
      return null;
    }

    if (block.byteLength < tarBlockSize) {
      throw new Error("Invalid backup archive: truncated tar header");
    }

    return block;
  }

  async readExact(size: number, errorMessage: string): Promise<Buffer> {
    const chunk = await this.readChunk(size);
    if (chunk.byteLength !== size) {
      throw new Error(errorMessage);
    }

    return chunk;
  }

  async skipPadding(size: number): Promise<void> {
    const paddingSize = getPaddingSize(size);
    if (paddingSize === 0) {
      return;
    }

    await this.readExact(paddingSize, "Invalid backup archive: truncated tar padding");
  }

  private async readChunk(size: number): Promise<Buffer> {
    const buffer = Buffer.allocUnsafe(size);
    let totalBytesRead = 0;

    while (totalBytesRead < size) {
      const { bytesRead } = await this.archive.read(
        buffer,
        totalBytesRead,
        size - totalBytesRead,
        this.offset,
      );

      if (bytesRead === 0) {
        break;
      }

      totalBytesRead += bytesRead;
      this.offset += bytesRead;
    }

    return buffer.subarray(0, totalBytesRead);
  }
}

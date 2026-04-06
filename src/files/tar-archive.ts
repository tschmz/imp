import { mkdir, open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";

const tarBlockSize = 512;
const zeroBlock = Buffer.alloc(tarBlockSize, 0);

interface TarEntry {
  path: string;
  type: "file" | "directory";
  mode: number;
  size: number;
  mtime: number;
}

export async function createTarArchive(sourceDir: string, outputPath: string): Promise<void> {
  const archive = await open(outputPath, "w", 0o600);

  try {
    for (const entry of await listTarEntries(sourceDir)) {
      await archive.write(buildTarHeader(entry));

      if (entry.type === "file") {
        const content = await readFile(join(sourceDir, entry.path));
        await archive.write(content);
        await writePadding(archive, content.byteLength);
      }
    }

    await archive.write(zeroBlock);
    await archive.write(zeroBlock);
    await archive.chmod(0o600);
  } finally {
    await archive.close();
  }
}

export async function extractTarArchive(archivePath: string, outputDir: string): Promise<void> {
  const archive = await readFile(archivePath);
  let offset = 0;

  while (offset < archive.byteLength) {
    if (offset + tarBlockSize > archive.byteLength) {
      throw new Error("Invalid backup archive: truncated tar header");
    }

    const header = archive.subarray(offset, offset + tarBlockSize);
    offset += tarBlockSize;

    if (isZeroBlock(header)) {
      break;
    }

    assertHeaderChecksum(header);
    const entry = parseTarHeader(header);
    const targetPath = resolve(outputDir, entry.path);
    assertArchivePath(targetPath, outputDir);

    if (entry.type === "directory") {
      await mkdir(targetPath, { recursive: true, mode: entry.mode });
      continue;
    }

    await mkdir(dirname(targetPath), { recursive: true });
    const entryLength = entry.size + getPaddingSize(entry.size);
    if (offset + entryLength > archive.byteLength) {
      throw new Error(`Invalid backup archive: truncated tar entry for ${entry.path}`);
    }

    const content = archive.subarray(offset, offset + entry.size);
    await writeFile(targetPath, content, { mode: entry.mode });
    offset += entryLength;
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
    .replace(/\0.*$/, "")
    .trim();
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

async function writePadding(
  archive: Awaited<ReturnType<typeof open>>,
  size: number,
): Promise<void> {
  const paddingSize = getPaddingSize(size);
  if (paddingSize > 0) {
    await archive.write(Buffer.alloc(paddingSize, 0));
  }
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

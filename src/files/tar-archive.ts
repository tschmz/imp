import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import tar from "tar-stream";
import type { Headers, Pack } from "tar-stream";

interface TarEntry {
  path: string;
  type: "file" | "directory";
  mode: number;
  size: number;
  mtime: Date;
}

interface ExtractTarArchiveOptions {
  maxEntrySizeBytes?: number;
  maxEntries?: number;
}

const defaultExtractLimits: Required<ExtractTarArchiveOptions> = {
  maxEntrySizeBytes: 512 * 1024 * 1024,
  maxEntries: 10_000,
};
const tarBlockSize = 512;

export async function createTarArchive(sourceDir: string, outputPath: string): Promise<void> {
  const pack = tar.pack();
  const writeArchive = pipeline(pack, createWriteStream(outputPath, { mode: 0o600 }));

  try {
    for (const entry of await listTarEntries(sourceDir)) {
      await addArchiveEntry(pack, sourceDir, entry);
    }

    pack.finalize();
    await writeArchive;
    await chmod(outputPath, 0o600);
  } catch (error) {
    pack.destroy(error instanceof Error ? error : new Error(String(error)));
    await writeArchive.catch(() => undefined);
    throw error;
  }
}

export async function extractTarArchive(
  archivePath: string,
  outputDir: string,
  options: ExtractTarArchiveOptions = {},
): Promise<void> {
  const archiveStat = await stat(archivePath);
  if (archiveStat.size % tarBlockSize !== 0) {
    throw new Error("Invalid backup archive: truncated tar entry");
  }

  const extract = tar.extract();
  const directoryModes = new Map<string, number>();
  const limits = { ...defaultExtractLimits, ...options };
  let entries = 0;
  let activeEntryName: string | undefined;

  extract.on("entry", (header, stream, next) => {
    activeEntryName = header.name;
    void processArchiveEntry(header, stream, {
      outputDir,
      directoryModes,
      limits,
      incrementEntries() {
        entries += 1;
        return entries;
      },
    }).then(
      () => next(),
      (error) => next(error),
    );
  });
  extract.on("error", () => {
    // The pipeline promise below is the single error-reporting surface for callers.
  });

  try {
    await pipeline(createReadStream(archivePath), extract);
  } catch (error) {
    throw normalizeTarReadError(error, activeEntryName);
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
        mtime: fileStat.mtime,
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
        mtime: fileStat.mtime,
      });
    }
  }

  return entries;
}

async function addArchiveEntry(pack: Pack, sourceDir: string, entry: TarEntry): Promise<void> {
  const header: Headers = {
    name: entry.path,
    type: entry.type,
    mode: entry.mode,
    size: entry.size,
    mtime: entry.mtime,
  };

  if (entry.type === "directory") {
    await addBufferedEntry(pack, header, Buffer.alloc(0));
    return;
  }

  await addFileEntry(pack, header, join(sourceDir, entry.path));
}

async function addBufferedEntry(pack: Pack, header: Headers, content: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    pack.entry(header, content, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function addFileEntry(pack: Pack, header: Headers, sourcePath: string): Promise<void> {
  const entry = pack.entry(header);
  await pipeline(createReadStream(sourcePath), entry);
}

async function processArchiveEntry(
  header: Headers,
  stream: NodeJS.ReadableStream,
  options: {
    outputDir: string;
    directoryModes: Map<string, number>;
    limits: Required<ExtractTarArchiveOptions>;
    incrementEntries: () => number;
  },
): Promise<void> {
  const entries = options.incrementEntries();
  if (entries > options.limits.maxEntries) {
    stream.resume();
    throw new Error(`Invalid backup archive: entry count exceeds limit (${options.limits.maxEntries})`);
  }

  if (header.type !== "file" && header.type !== "directory") {
    stream.resume();
    return;
  }

  const entryPath = header.name;
  const targetPath = resolve(options.outputDir, entryPath);
  assertArchivePath(targetPath, options.outputDir);

  const entrySize = header.size ?? 0;
  if (entrySize > options.limits.maxEntrySizeBytes) {
    stream.resume();
    throw new Error(
      `Invalid backup archive: tar entry too large for ${entryPath} (${entrySize} bytes exceeds ${options.limits.maxEntrySizeBytes})`,
    );
  }

  const mode = header.mode ?? 0o600;
  if (header.type === "directory") {
    stream.resume();
    await mkdir(targetPath, { recursive: true, mode: 0o700 });
    options.directoryModes.set(targetPath, normalizeExtractedDirectoryMode(mode));
    return;
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await pipeline(stream, createWriteStream(targetPath, { mode }));
}

function normalizeTarReadError(error: unknown, activeEntryName: string | undefined): Error {
  if (error instanceof Error && /unexpected end of data/i.test(error.message)) {
    return new Error(
      activeEntryName
        ? `Invalid backup archive: truncated tar entry for ${activeEntryName}`
        : "Invalid backup archive: truncated tar entry",
    );
  }

  if (error instanceof Error && /invalid tar header|invalid header|invalid tar/i.test(error.message)) {
    return new Error(`Invalid backup archive: ${error.message}`);
  }

  return error instanceof Error ? error : new Error(String(error));
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

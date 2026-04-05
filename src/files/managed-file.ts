import { access, mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface ManagedFileOptions {
  path: string;
  resourceLabel: string;
  force?: boolean;
  now?: Date;
  mode?: number;
}

export async function assertManagedFileCanBeWritten(
  options: ManagedFileOptions,
): Promise<string> {
  const path = resolve(options.path);

  if (options.force) {
    return path;
  }

  try {
    await access(path);
  } catch (error) {
    if (isMissingFileError(error)) {
      return path;
    }
    throw error;
  }

  throw new Error(
    `${options.resourceLabel} already exists: ${path}\nRe-run with --force to overwrite.`,
  );
}

export async function writeManagedFile(options: ManagedFileOptions & { content: string }): Promise<string> {
  const path = resolve(options.path);
  const mode = options.mode ?? 0o600;

  await mkdir(dirname(path), { recursive: true });
  if (options.force) {
    await backupExistingFile({
      path,
      now: options.now ?? new Date(),
      mode,
    });
  }

  try {
    const file = await open(path, options.force ? "w" : "wx", mode);
    try {
      await file.writeFile(options.content, { encoding: "utf8" });
      await file.chmod(mode);
    } finally {
      await file.close();
    }
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new Error(
        `${options.resourceLabel} already exists: ${path}\nRe-run with --force to overwrite.`,
      );
    }

    throw error;
  }

  return path;
}

async function backupExistingFile(options: {
  path: string;
  now: Date;
  mode: number;
}): Promise<void> {
  let sourceFile;
  try {
    sourceFile = await open(options.path, "r");
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }

  try {
    const content = await sourceFile.readFile({ encoding: "utf8" });
    const backupPath = `${options.path}.${formatBackupTimestamp(options.now)}.bak`;
    const backupFile = await open(backupPath, "w", options.mode);
    try {
      await backupFile.writeFile(content, { encoding: "utf8" });
      await backupFile.chmod(options.mode);
    } finally {
      await backupFile.close();
    }
  } finally {
    await sourceFile.close();
  }
}

function formatBackupTimestamp(date: Date): string {
  return date.toISOString().replaceAll(":", "-");
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

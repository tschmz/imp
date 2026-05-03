import { readdir, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

const ignoredDirectoryNames = new Set([".git", "node_modules"]);

export interface WalkedFile {
  absolutePath: string;
  relativePath: string;
}

export async function collectFiles(root: string, limit = Number.POSITIVE_INFINITY): Promise<WalkedFile[]> {
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    return [{ absolutePath: root, relativePath: basename(root) }];
  }

  const files: WalkedFile[] = [];
  await walkDirectory(root, root, files, limit);
  return files;
}

export function matchesGlob(path: string, glob: string | undefined): boolean {
  if (!glob) {
    return true;
  }
  return globToRegExp(glob).test(normalizePath(path));
}

async function walkDirectory(
  root: string,
  directory: string,
  files: WalkedFile[],
  limit: number,
): Promise<void> {
  if (files.length >= limit) {
    return;
  }

  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (files.length >= limit) {
      return;
    }
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) {
      continue;
    }

    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(root, absolutePath, files, limit);
    } else if (entry.isFile()) {
      files.push({
        absolutePath,
        relativePath: normalizePath(relative(root, absolutePath)),
      });
    }
  }
}

function globToRegExp(glob: string): RegExp {
  const normalized = normalizePath(glob);
  let pattern = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      pattern += ".*";
      index += 1;
    } else if (char === "*") {
      pattern += "[^/]*";
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += escapeRegExp(char ?? "");
    }
  }
  return new RegExp(`^${pattern}$`);
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

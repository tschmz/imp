import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export async function writeJsonAtomic(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function ensureDirs(paths) {
  await Promise.all(paths.map((path) => mkdir(path, { recursive: true })));
}

export async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function buildClaimedFileName(fileName) {
  return `${Date.now()}-${randomUUID()}-${sanitizeFileName(fileName)}`;
}

export function sanitizeFileName(value) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_") || "file.json";
}

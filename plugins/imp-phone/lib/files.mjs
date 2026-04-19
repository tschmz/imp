import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function ensureDirs(paths) {
  await Promise.all(paths.map((path) => mkdir(path, { recursive: true })));
}

export async function writeJsonAtomic(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

export function sanitizeFileName(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, "_");
}

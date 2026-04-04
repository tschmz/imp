import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AppConfig } from "./types.js";
import { appConfigSchema } from "./schema.js";

export async function loadAppConfig(configPath: string): Promise<AppConfig> {
  const absolutePath = resolve(configPath);
  const raw = await readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const result = appConfigSchema.safeParse(parsed);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid config file ${absolutePath}\n${details}`);
  }

  return result.data;
}

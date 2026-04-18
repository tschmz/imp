import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AppConfig } from "./types.js";
import { appConfigSchema } from "./schema.js";
import { parseConfigJson } from "./config-json.js";

export interface LoadAppConfigIssue {
  path: PropertyKey[];
  message: string;
}

export interface LoadAppConfigOptions {
  errorPrefix?: string;
  validateSchema?: boolean;
}

export class LoadAppConfigError extends Error {
  readonly configPath: string;
  readonly issues: LoadAppConfigIssue[];

  constructor(message: string, options: { configPath: string; issues?: LoadAppConfigIssue[]; cause?: unknown }) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "LoadAppConfigError";
    this.configPath = options.configPath;
    this.issues = options.issues ?? [];
  }
}

export function formatLoadAppConfigIssues(issues: LoadAppConfigIssue[]): string {
  return issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("\n");
}

export async function loadAppConfig(configPath: string, options?: LoadAppConfigOptions): Promise<AppConfig>;
export async function loadAppConfig(
  configPath: string,
  options: LoadAppConfigOptions & { validateSchema: false },
): Promise<unknown>;
export async function loadAppConfig(configPath: string, options: LoadAppConfigOptions = {}): Promise<AppConfig | unknown> {
  const absolutePath = resolve(configPath);
  const errorPrefix = options.errorPrefix ?? `Invalid config file ${absolutePath}`;
  const validateSchema = options.validateSchema !== false;
  const raw = await readFile(absolutePath, "utf8");
  let parsed: unknown;
  try {
    parsed = parseConfigJson(raw, { errorPrefix });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LoadAppConfigError(message, { configPath: absolutePath, cause: error });
  }

  if (!validateSchema) {
    return parsed;
  }

  const result = appConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
    const details = formatLoadAppConfigIssues(issues);
    throw new LoadAppConfigError(`${errorPrefix}\n${details}`, {
      configPath: absolutePath,
      issues,
    });
  }

  return result.data;
}

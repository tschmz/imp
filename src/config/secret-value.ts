import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

const environmentVariableNamePattern = /^[A-Z_][A-Z0-9_]*$/i;

const secretReferenceSchema = z
  .object({
    env: z.string().min(1).regex(environmentVariableNamePattern, {
      message: "Environment variable names must match /^[A-Z_][A-Z0-9_]*$/i.",
    }).optional(),
    file: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasEnv = typeof value.env === "string";
    const hasFile = typeof value.file === "string";

    if (hasEnv === hasFile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Specify exactly one of env or file.",
      });
    }
  });

export const secretValueConfigSchema = z.union([z.string().min(1), secretReferenceSchema]);

export type SecretReferenceConfig = z.infer<typeof secretReferenceSchema>;
export type SecretValueConfig = z.infer<typeof secretValueConfigSchema>;

interface ResolveSecretValueOptions {
  configDir: string;
  env?: NodeJS.ProcessEnv;
  readTextFile?: (path: string) => Promise<string>;
  fieldLabel: string;
}

export async function resolveSecretValue(
  value: SecretValueConfig,
  options: ResolveSecretValueOptions,
): Promise<string> {
  if (typeof value === "string") {
    return value;
  }

  if ("env" in value && value.env) {
    const resolvedValue = (options.env ?? process.env)[value.env];
    if (typeof resolvedValue !== "string" || resolvedValue.length === 0) {
      throw new Error(`${options.fieldLabel} references environment variable ${value.env}, but it is not set.`);
    }

    return resolvedValue;
  }

  if (!("file" in value) || !value.file) {
    throw new Error(`${options.fieldLabel} secret reference is invalid.`);
  }

  const secretPath = resolveConfigPath(value.file, options.configDir);
  const readTextFile = options.readTextFile ?? defaultReadTextFile;

  let rawSecret: string;
  try {
    rawSecret = await readTextFile(secretPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${options.fieldLabel} references secret file ${secretPath}, but it could not be read: ${message}`);
  }

  const normalizedSecret = stripSingleTrailingLineEnding(rawSecret);
  if (normalizedSecret.length === 0) {
    throw new Error(`${options.fieldLabel} references secret file ${secretPath}, but it is empty.`);
  }

  return normalizedSecret;
}

export function resolveConfigPath(path: string, configDir: string): string {
  return isAbsolute(path) ? path : resolve(configDir, path);
}

async function defaultReadTextFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function stripSingleTrailingLineEnding(value: string): string {
  if (value.endsWith("\r\n")) {
    return value.slice(0, -2);
  }

  if (value.endsWith("\n")) {
    return value.slice(0, -1);
  }

  return value;
}

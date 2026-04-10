import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getOAuthApiKey, getOAuthProvider } from "@mariozechner/pi-ai/oauth";
import type { Logger } from "../logging/types.js";

type OAuthCredentialStore = Parameters<typeof getOAuthApiKey>[1];
type StoredOAuthCredentials = OAuthCredentialStore[string] & {
  type?: "oauth";
};

interface OAuthApiKeyResolverDependencies {
  readTextFile?: (path: string) => Promise<string>;
  writeTextFile?: (path: string, content: string) => Promise<void>;
  getOAuthApiKeyFn?: typeof getOAuthApiKey;
}

export function createOAuthApiKeyResolver(
  authFilePath: string | undefined,
  logger?: Logger,
  dependencies: OAuthApiKeyResolverDependencies = {},
): (provider: string) => Promise<string | undefined> {
  const readTextFile = dependencies.readTextFile ?? defaultReadTextFile;
  const writeTextFile = dependencies.writeTextFile ?? defaultWriteTextFile;
  const resolveOAuthApiKey = dependencies.getOAuthApiKeyFn ?? getOAuthApiKey;

  return async (provider) => {
    if (!authFilePath || !getOAuthProvider(provider)) {
      return undefined;
    }

    let auth: OAuthCredentialStore & Record<string, StoredOAuthCredentials>;
    try {
      auth = await loadAuthFile(authFilePath, readTextFile);
    } catch (error) {
      await logger?.error("failed to load oauth credentials", undefined, error);
      return undefined;
    }

    try {
      const result = await resolveOAuthApiKey(provider, auth);
      if (!result) {
        return undefined;
      }

      auth[provider] = {
        type: "oauth",
        ...result.newCredentials,
      };
      await writeTextFile(authFilePath, `${JSON.stringify(auth, null, 2)}\n`);
      return result.apiKey;
    } catch (error) {
      await logger?.error("failed to refresh oauth credentials", undefined, error);
      return undefined;
    }
  };
}

async function loadAuthFile(
  path: string,
  readTextFile: (path: string) => Promise<string>,
): Promise<Record<string, StoredOAuthCredentials>> {
  try {
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed)
      ? (parsed as OAuthCredentialStore & Record<string, StoredOAuthCredentials>)
      : {};
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }
    throw error;
  }
}

async function defaultReadTextFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function defaultWriteTextFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

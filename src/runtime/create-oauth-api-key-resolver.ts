import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  type AuthOperationOptions,
  type Credential,
  type CredentialInfo,
  type CredentialStore,
  type OAuthCredential,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import writeFileAtomic from "write-file-atomic";
import type { Logger } from "../logging/types.js";
import { isOAuthProvider } from "./pi-ai-runtime.js";

type StoredOAuthCredentials = {
  type?: "oauth";
  access: string;
  refresh: string;
  expires: number;
} & Record<string, unknown>;

type OAuthCredentialStore = Record<string, StoredOAuthCredentials>;

interface OAuthApiKeyResolution {
  apiKey: string;
  newCredentials: StoredOAuthCredentials;
}

type OAuthApiKeyResolverFunction = (
  provider: string,
  credentials: OAuthCredentialStore,
) => Promise<OAuthApiKeyResolution | undefined>;

type StoredOAuthCredentialMap = Record<string, StoredOAuthCredentials>;

class MemoryCredentialStore implements CredentialStore {
  private readonly credentials = new Map<string, Credential>();

  constructor(seed: StoredOAuthCredentialMap) {
    for (const [providerId, credential] of Object.entries(seed)) {
      const normalized = normalizeOAuthCredential(credential);
      if (normalized) {
        this.credentials.set(providerId, normalized);
      }
    }
  }

  async read(providerId: string, _options?: AuthOperationOptions): Promise<Credential | undefined> {
    void _options;
    return this.credentials.get(providerId);
  }

  async list(_options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    void _options;
    return Array.from(this.credentials, ([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }

  async modify(
    providerId: string,
    update: (current: Credential | undefined) => Promise<Credential | undefined>,
    _options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    void _options;
    const current = this.credentials.get(providerId);
    const next = await update(current);
    if (next) {
      this.credentials.set(providerId, next);
      return next;
    }

    return current;
  }

  async delete(providerId: string, _options?: AuthOperationOptions): Promise<void> {
    void _options;
    this.credentials.delete(providerId);
  }
}

const authFileReadRetryCount = 5;
const authFileReadRetryDelayMs = 25;

interface OAuthApiKeyResolverDependencies {
  readTextFile?: (path: string) => Promise<string>;
  writeTextFile?: (path: string, content: string) => Promise<void>;
  getOAuthApiKeyFn?: OAuthApiKeyResolverFunction;
}

export function createOAuthApiKeyResolver(
  authFilePath: string | undefined,
  logger?: Logger,
  dependencies: OAuthApiKeyResolverDependencies = {},
): (provider: string) => Promise<string | undefined> {
  const readTextFile = dependencies.readTextFile ?? defaultReadTextFile;
  const writeTextFile = dependencies.writeTextFile ?? defaultWriteTextFile;
  const resolveOAuthApiKey = dependencies.getOAuthApiKeyFn ?? resolveOAuthApiKeyWithPiModels;

  return async (provider) => {
    if (!authFilePath || !isOAuthProvider(provider)) {
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

async function resolveOAuthApiKeyWithPiModels(
  provider: string,
  credentials: OAuthCredentialStore,
): Promise<OAuthApiKeyResolution | undefined> {
  if (!normalizeOAuthCredential(credentials[provider])) {
    return undefined;
  }

  const credentialStore = new MemoryCredentialStore(credentials);
  const models = builtinModels({ credentials: credentialStore });
  const result = await models.getAuth(provider);
  const updated = await credentialStore.read(provider);
  if (!result?.auth.apiKey || updated?.type !== "oauth") {
    return undefined;
  }

  return {
    apiKey: result.auth.apiKey,
    newCredentials: updated,
  };
}

async function loadAuthFile(
  path: string,
  readTextFile: (path: string) => Promise<string>,
): Promise<Record<string, StoredOAuthCredentials>> {
  for (let attempt = 0; attempt <= authFileReadRetryCount; attempt += 1) {
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

      if (isJsonParseError(error) && attempt < authFileReadRetryCount) {
        await sleep(authFileReadRetryDelayMs);
        continue;
      }

      throw error;
    }
  }

  return {};
}

async function defaultReadTextFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function defaultWriteTextFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, content, { encoding: "utf8" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeOAuthCredential(value: unknown): OAuthCredential | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    typeof value.access !== "string" ||
    typeof value.refresh !== "string" ||
    typeof value.expires !== "number"
  ) {
    return undefined;
  }

  return {
    ...value,
    type: "oauth",
    access: value.access,
    refresh: value.refresh,
    expires: value.expires,
  };
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isJsonParseError(error: unknown): error is SyntaxError {
  return error instanceof SyntaxError;
}

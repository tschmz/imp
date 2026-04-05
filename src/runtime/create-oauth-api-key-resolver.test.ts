import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../logging/types.js";
import { createOAuthApiKeyResolver } from "./create-oauth-api-key-resolver.js";

describe("createOAuthApiKeyResolver", () => {
  it("returns undefined when no auth file path is configured", async () => {
    const resolveApiKey = createOAuthApiKeyResolver(undefined);

    await expect(resolveApiKey("openai-codex")).resolves.toBeUndefined();
  });

  it("returns undefined for non-oauth providers", async () => {
    const readTextFile = vi.fn();
    const resolveApiKey = createOAuthApiKeyResolver("/tmp/auth.json", undefined, {
      readTextFile,
    });

    await expect(resolveApiKey("openai")).resolves.toBeUndefined();
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it("loads oauth credentials, refreshes them, and persists the updated token", async () => {
    const writeTextFile = vi.fn(async () => {});
    const getOAuthApiKeyFn = vi.fn<
      (providerId: string, credentials: Record<string, unknown>) => Promise<{
        apiKey: string;
        newCredentials: {
          access: string;
          refresh: string;
          expires: number;
          accountId: string;
        };
      }>
    >(async () => ({
      apiKey: "access-token",
      newCredentials: {
        access: "access-token",
        refresh: "refresh-token-2",
        expires: 200,
        accountId: "acct-1",
      },
    }));
    const resolveApiKey = createOAuthApiKeyResolver("/tmp/auth.json", undefined, {
      readTextFile: async () =>
        JSON.stringify({
          "openai-codex": {
            type: "oauth",
            access: "access-token-1",
            refresh: "refresh-token-1",
            expires: 100,
            accountId: "acct-1",
          },
        }),
      writeTextFile,
      getOAuthApiKeyFn,
    });

    await expect(resolveApiKey("openai-codex")).resolves.toBe("access-token");
    expect(getOAuthApiKeyFn).toHaveBeenCalledTimes(1);
    expect(getOAuthApiKeyFn.mock.calls[0]?.[0]).toBe("openai-codex");
    expect(writeTextFile).toHaveBeenCalledWith(
      "/tmp/auth.json",
      `${JSON.stringify(
        {
          "openai-codex": {
            type: "oauth",
            access: "access-token",
            refresh: "refresh-token-2",
            expires: 200,
            accountId: "acct-1",
          },
        },
        null,
        2,
      )}\n`,
    );
  });

  it("logs and returns undefined when oauth refresh fails", async () => {
    const logger = createMockLogger();
    const resolveApiKey = createOAuthApiKeyResolver("/tmp/auth.json", logger, {
      readTextFile: async () =>
        JSON.stringify({
          "openai-codex": {
            type: "oauth",
            access: "access-token-1",
            refresh: "refresh-token-1",
            expires: 100,
          },
        }),
      getOAuthApiKeyFn: async () => {
        throw new Error("refresh failed");
      },
    });

    await expect(resolveApiKey("openai-codex")).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "failed to refresh oauth credentials",
      undefined,
      expect.any(Error),
    );
  });
});

function createMockLogger(): Logger {
  return {
    debug: vi.fn(async () => {}),
    info: vi.fn(async () => {}),
    error: vi.fn(async () => {}),
  };
}

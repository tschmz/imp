import { createHash } from "node:crypto";
import type { AgentDefinition } from "../domain/agent.js";

export interface CacheStrategy<Value> {
  get(key: string): Value | undefined;
  set(key: string, value: Value): void;
  delete(key: string): void;
}

export class InMemoryCacheStrategy<Value> implements CacheStrategy<Value> {
  readonly #entries = new Map<string, Value>();

  get(key: string): Value | undefined {
    return this.#entries.get(key);
  }

  set(key: string, value: Value): void {
    this.#entries.set(key, value);
  }

  delete(key: string): void {
    this.#entries.delete(key);
  }
}

export interface SystemPromptCacheDependencies {
  getContextFileFingerprint: (path: string) => Promise<string>;
  readTextFile: (path: string) => Promise<string>;
  strategy?: CacheStrategy<string>;
}

export interface SystemPromptCacheKeyInput {
  agent: AgentDefinition;
  promptWorkingDirectory?: string;
  promptFiles: string[];
}

export class SystemPromptCache {
  readonly #getContextFileFingerprint: (path: string) => Promise<string>;
  readonly #readTextFile: (path: string) => Promise<string>;
  readonly #strategy: CacheStrategy<string>;
  readonly #latestCacheKeyByAgentId = new Map<string, string>();

  constructor(dependencies: SystemPromptCacheDependencies) {
    this.#getContextFileFingerprint = dependencies.getContextFileFingerprint;
    this.#readTextFile = dependencies.readTextFile;
    this.#strategy = dependencies.strategy ?? new InMemoryCacheStrategy<string>();
  }

  async buildCacheKey(input: SystemPromptCacheKeyInput): Promise<string> {
    const fileFingerprints = await Promise.all(
      input.promptFiles.map(async (path) => {
        try {
          const fingerprint = await this.#getContextFileFingerprint(path);
          return `${path}:${fingerprint}`;
        } catch {
          try {
            const content = await this.#readTextFile(path);
            const hash = createHash("sha256").update(content).digest("hex");
            return `${path}:sha256:${hash}`;
          } catch {
            return `${path}:unreadable`;
          }
        }
      }),
    );

    return JSON.stringify({
      agentId: input.agent.id,
      systemPrompt: input.agent.systemPrompt,
      systemPromptFile: input.agent.systemPromptFile,
      promptWorkingDirectory: input.promptWorkingDirectory,
      files: fileFingerprints,
    });
  }

  get(cacheKey: string): string | undefined {
    return this.#strategy.get(cacheKey);
  }

  set(agentId: string, cacheKey: string, systemPrompt: string): void {
    this.#strategy.set(cacheKey, systemPrompt);

    const previousCacheKey = this.#latestCacheKeyByAgentId.get(agentId);
    if (previousCacheKey !== undefined && previousCacheKey !== cacheKey) {
      this.#strategy.delete(previousCacheKey);
    }

    this.#latestCacheKeyByAgentId.set(agentId, cacheKey);
  }
}

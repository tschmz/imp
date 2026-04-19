import { createHash } from "node:crypto";
import type { AgentDefinition, PromptSource } from "../domain/agent.js";
import type { SkillDefinition } from "../skills/types.js";
import type { PromptTemplateContext } from "./prompt-template.js";

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
  templateContext: PromptTemplateContext;
  availableSkills?: SkillDefinition[];
  runtimeUsage?: PromptTemplateRuntimeUsage;
}

export interface PromptTemplateRuntimeUsage {
  exactNow: boolean;
  minuteNow: boolean;
  dateNow: boolean;
}

export class SystemPromptCache {
  readonly #getContextFileFingerprint: (path: string) => Promise<string>;
  readonly #readTextFile: (path: string) => Promise<string>;
  readonly #strategy: CacheStrategy<string>;
  readonly #latestCacheKeyByAgentId = new Map<string, string>();
  readonly #runtimeUsageByStableCacheKey = new Map<string, PromptTemplateRuntimeUsage>();

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

    const stablePayload = {
      agentId: input.agent.id,
      prompt: serializePromptSource(input.agent.prompt.base),
      instructions: (input.agent.prompt.instructions ?? []).map(serializePromptSource),
      references: (input.agent.prompt.references ?? []).map(serializePromptSource),
      promptWorkingDirectory: input.promptWorkingDirectory,
      templateContext: createCacheTemplateContext(input.templateContext),
      availableSkills: (input.availableSkills ?? []).map((skill) => ({
        directoryPath: skill.directoryPath,
        filePath: skill.filePath,
        name: skill.name,
        description: skill.description,
      })),
      files: fileFingerprints,
    };
    const stableCacheKey = JSON.stringify(stablePayload);
    const runtimeUsage = mergeRuntimeUsages(
      input.runtimeUsage,
      this.#runtimeUsageByStableCacheKey.get(stableCacheKey),
    );
    if (runtimeUsage && runtimeUsageHasValues(input.runtimeUsage)) {
      this.#runtimeUsageByStableCacheKey.set(stableCacheKey, runtimeUsage);
    }

    return JSON.stringify({
      ...stablePayload,
      templateContext: createCacheTemplateContext(input.templateContext, runtimeUsage),
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

function createCacheTemplateContext(
  context: PromptTemplateContext,
  runtimeUsage?: PromptTemplateRuntimeUsage,
): Omit<PromptTemplateContext, "runtime"> & { runtime: Record<string, unknown> } {
  const { runtime, ...stableContext } = context;
  const cacheRuntime: Record<string, unknown> = {
    timezone: runtime.timezone,
  };
  if (runtimeUsage?.exactNow) {
    cacheRuntime.now = runtime.now;
  } else if (runtimeUsage?.minuteNow) {
    cacheRuntime.now = {
      date: runtime.now.date,
      timeMinute: runtime.now.timeMinute,
      localMinute: runtime.now.localMinute,
    };
  } else if (runtimeUsage?.dateNow) {
    cacheRuntime.now = {
      date: runtime.now.date,
    };
  }
  return {
    ...stableContext,
    runtime: cacheRuntime,
  };
}

function mergeRuntimeUsages(
  first: PromptTemplateRuntimeUsage | undefined,
  second: PromptTemplateRuntimeUsage | undefined,
): PromptTemplateRuntimeUsage | undefined {
  if (!first && !second) {
    return undefined;
  }
  return {
    exactNow: Boolean(first?.exactNow || second?.exactNow),
    minuteNow: Boolean(first?.minuteNow || second?.minuteNow),
    dateNow: Boolean(first?.dateNow || second?.dateNow),
  };
}

function runtimeUsageHasValues(runtimeUsage: PromptTemplateRuntimeUsage | undefined): boolean {
  return Boolean(runtimeUsage?.exactNow || runtimeUsage?.minuteNow || runtimeUsage?.dateNow);
}

function serializePromptSource(source: PromptSource): Record<string, string> {
  if (source.file) {
    return { file: source.file };
  }

  if (source.builtIn) {
    return { builtIn: source.builtIn };
  }

  return { text: source.text ?? "" };
}

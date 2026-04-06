import { join } from "node:path";
import type { AgentDefinition } from "../domain/agent.js";
import type { SystemPromptCache } from "./system-prompt-cache.js";

export interface SystemPromptResolutionOptions {
  agent: AgentDefinition;
  promptWorkingDirectory?: string;
  readTextFile: (path: string) => Promise<string>;
  cache: SystemPromptCache;
}

export interface SystemPromptResolutionResult {
  systemPrompt: string;
  cacheHit: boolean;
}

export async function resolveSystemPrompt(
  options: SystemPromptResolutionOptions,
): Promise<SystemPromptResolutionResult> {
  const promptFiles = [
    options.agent.systemPromptFile,
    ...resolveContextPromptFiles(options.agent, options.promptWorkingDirectory).map((file) => file.path),
  ].filter((path): path is string => path !== undefined);

  const cacheKey = await options.cache.buildCacheKey({
    agent: options.agent,
    promptWorkingDirectory: options.promptWorkingDirectory,
    promptFiles,
  });

  const cachedPrompt = options.cache.get(cacheKey);
  if (cachedPrompt !== undefined) {
    return {
      systemPrompt: cachedPrompt,
      cacheHit: true,
    };
  }

  const systemPrompt = await buildSystemPrompt(
    options.agent,
    options.promptWorkingDirectory,
    options.readTextFile,
  );

  options.cache.set(options.agent.id, cacheKey, systemPrompt);

  return {
    systemPrompt,
    cacheHit: false,
  };
}

export async function buildSystemPrompt(
  agent: AgentDefinition,
  promptWorkingDirectory: string | undefined,
  readTextFile: (path: string) => Promise<string>,
): Promise<string> {
  const sections: string[] = [];

  if (agent.systemPromptFile) {
    let content: string;
    try {
      content = await readTextFile(agent.systemPromptFile);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to read system prompt file for agent "${agent.id}": ${agent.systemPromptFile} (${detail})`,
      );
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      throw new Error(
        `System prompt file for agent "${agent.id}" is empty: ${agent.systemPromptFile}`,
      );
    }

    sections.push(trimmedContent);
  } else if (agent.systemPrompt) {
    sections.push(agent.systemPrompt);
  } else {
    throw new Error(`Agent "${agent.id}" must define systemPrompt or systemPromptFile.`);
  }

  const contextFiles = resolveContextPromptFiles(agent, promptWorkingDirectory);

  for (const file of contextFiles) {
    let content: string;
    try {
      content = await readTextFile(file.path);
    } catch (error) {
      if (file.optional && isFileNotFoundError(error)) {
        continue;
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to read context file for agent "${agent.id}": ${file.path} (${detail})`,
      );
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      continue;
    }

    sections.push(formatContextInstructions(file.path, trimmedContent));
  }

  return sections.join("\n\n");
}

function formatContextInstructions(path: string, content: string): string {
  return `<INSTRUCTIONS from="${escapeInstructionAttribute(path)}">\n\n${content}\n</INSTRUCTIONS>`;
}

function escapeInstructionAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

export function resolveContextPromptFiles(
  agent: AgentDefinition,
  promptWorkingDirectory: string | undefined,
): Array<{ path: string; optional: boolean }> {
  const files = (agent.context?.files ?? []).map((path) => ({ path, optional: false }));
  const workingDirectoryAgentsFile = resolveWorkingDirectoryAgentsFile(promptWorkingDirectory);
  if (workingDirectoryAgentsFile && !files.some((file) => file.path === workingDirectoryAgentsFile)) {
    files.push({ path: workingDirectoryAgentsFile, optional: true });
  }
  return files;
}

function resolveWorkingDirectoryAgentsFile(workingDirectory: string | undefined): string | undefined {
  if (!workingDirectory) {
    return undefined;
  }

  return join(workingDirectory, "AGENTS.md");
}

function isFileNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = "code" in error ? error.code : undefined;
  if (code === "ENOENT") {
    return true;
  }

  const message = "message" in error ? error.message : undefined;
  return typeof message === "string" && message.includes("ENOENT");
}

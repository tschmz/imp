import { join } from "node:path";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "../agents/default-system-prompt.js";
import type { AgentDefinition, PromptSource } from "../domain/agent.js";
import type { SkillDefinition } from "../skills/types.js";
import { renderPromptTemplate, type PromptTemplateContext } from "./prompt-template.js";
import type { SystemPromptCache } from "./system-prompt-cache.js";

export interface SystemPromptResolutionOptions {
  agent: AgentDefinition;
  promptWorkingDirectory?: string;
  templateContext: PromptTemplateContext;
  availableSkills?: SkillDefinition[];
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
    ...resolvePromptFileSources(options.agent, options.promptWorkingDirectory).map((source) => source.path),
  ];

  const cacheKey = await options.cache.buildCacheKey({
    agent: options.agent,
    promptWorkingDirectory: options.promptWorkingDirectory,
    promptFiles,
    templateContext: options.templateContext,
    availableSkills: options.availableSkills,
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
    options.templateContext,
    options.availableSkills ?? [],
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
  templateContext: PromptTemplateContext,
  availableSkills: SkillDefinition[],
  readTextFile: (path: string) => Promise<string>,
): Promise<string> {
  const sections: string[] = [];
  const promptTemplateContext: PromptTemplateContext = {
    ...templateContext,
    skills: availableSkills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      directoryPath: skill.directoryPath,
      filePath: skill.filePath,
    })),
  };

  const basePrompt = await resolvePromptSourceContent(agent, agent.prompt.base, readTextFile, {
    kind: "base prompt",
    templateFileContent: true,
    templateContext: promptTemplateContext,
  });
  if (!basePrompt) {
    throw new Error(`Configured base prompt for agent "${agent.id}" must define text, file, or built-in source.`);
  }
  sections.push(basePrompt);

  for (const source of resolveInstructionSources(agent, promptWorkingDirectory)) {
    const content = await resolvePromptSourceContent(agent, source.source, readTextFile, {
      kind: "instruction file",
      optional: source.optional,
      templateFileContent: true,
      templateContext: promptTemplateContext,
    });
    if (!content) {
      continue;
    }

    sections.push(formatPromptSection("INSTRUCTIONS", describePromptSource(source.source), content));
  }

  for (const source of agent.prompt.references ?? []) {
    const content = await resolvePromptSourceContent(agent, source, readTextFile, {
      kind: "reference file",
      templateFileContent: true,
      templateContext: promptTemplateContext,
    });
    if (!content) {
      continue;
    }

    sections.push(formatPromptSection("REFERENCE", describePromptSource(source), content));
  }

  return sections.join("\n\n");
}

function formatPromptSection(tagName: "INSTRUCTIONS" | "REFERENCE", source: string, content: string): string {
  return `<${tagName} from="${escapeInstructionAttribute(source)}">\n\n${content}\n</${tagName}>`;
}

function escapeInstructionAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

export function resolveInstructionSources(
  agent: AgentDefinition,
  promptWorkingDirectory: string | undefined,
): Array<{ source: PromptSource; optional: boolean }> {
  const sources = (agent.prompt.instructions ?? []).map((source) => ({ source, optional: false }));
  const workingDirectoryAgentsFile = resolveWorkingDirectoryAgentsFile(promptWorkingDirectory);
  if (
    workingDirectoryAgentsFile &&
    !sources.some((entry) => entry.source.file === workingDirectoryAgentsFile)
  ) {
    sources.push({ source: { file: workingDirectoryAgentsFile }, optional: true });
  }
  return sources;
}

function resolvePromptFileSources(
  agent: AgentDefinition,
  promptWorkingDirectory: string | undefined,
): Array<{ path: string; optional: boolean }> {
  return [
    ...extractFileSources([agent.prompt.base]),
    ...extractFileSources(agent.prompt.references ?? []),
    ...resolveInstructionSources(agent, promptWorkingDirectory)
      .filter((entry) => entry.source.file)
      .map((entry) => ({ path: entry.source.file!, optional: entry.optional })),
  ];
}

function resolveWorkingDirectoryAgentsFile(workingDirectory: string | undefined): string | undefined {
  if (!workingDirectory) {
    return undefined;
  }

  return join(workingDirectory, "AGENTS.md");
}

async function resolvePromptSourceContent(
  agent: AgentDefinition,
  source: PromptSource,
  readTextFile: (path: string) => Promise<string>,
  options: {
    kind: string;
    optional?: boolean;
    templateFileContent: boolean;
    templateContext: PromptTemplateContext;
  },
): Promise<string | undefined> {
  if (source.text !== undefined) {
    const trimmedContent = source.text.trim();
    if (!trimmedContent) {
      throw new Error(`Configured ${options.kind} for agent "${agent.id}" is empty.`);
    }

    return trimmedContent;
  }

  if (source.builtIn === "default") {
    const content = renderPromptTemplate(DEFAULT_AGENT_SYSTEM_PROMPT, {
      filePath: "built-in:default-system-prompt",
      context: options.templateContext,
    });
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      throw new Error(`Built-in ${options.kind} for agent "${agent.id}" is empty.`);
    }

    return trimmedContent;
  }

  let content: string;
  if (!source.file) {
    throw new Error(`Configured ${options.kind} for agent "${agent.id}" must define text, file, or built-in source.`);
  }
  try {
    content = await readTextFile(source.file);
  } catch (error) {
    if (options.optional && isFileNotFoundError(error)) {
      return undefined;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to read ${options.kind} for agent "${agent.id}": ${source.file} (${detail})`,
    );
  }

  if (options.templateFileContent) {
    content = renderPromptTemplate(content, {
      filePath: source.file,
      context: options.templateContext,
    });
  }

  const trimmedContent = content.trim();
  if (!trimmedContent) {
    if (options.kind === "base prompt") {
      throw new Error(`Configured base prompt file for agent "${agent.id}" is empty: ${source.file}`);
    }

    return undefined;
  }

  return trimmedContent;
}

function extractFileSources(sources: PromptSource[]): Array<{ path: string; optional: boolean }> {
  return sources
    .filter((source): source is PromptSource & { file: string } => typeof source.file === "string")
    .map((source) => ({ path: source.file, optional: false }));
}

function describePromptSource(source: PromptSource): string {
  return source.file ?? source.builtIn ?? "inline";
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

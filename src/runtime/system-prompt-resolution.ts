import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "../agents/default-system-prompt.js";
import type { AgentDefinition, PromptSource } from "../domain/agent.js";
import type { SkillDefinition } from "../skills/types.js";
import {
  createEmptyPromptIncludedFiles,
  mapSkillsToPromptTemplateContext,
  renderPromptTemplate,
  renderPromptSections,
  type PromptTemplateContext,
  type PromptTemplateIncludedFileContext,
} from "./prompt-template.js";
import type { PromptTemplateRuntimeUsage, SystemPromptCache } from "./system-prompt-cache.js";

export interface SystemPromptResolutionOptions {
  agent: AgentDefinition;
  promptWorkingDirectory?: string;
  templateContext: PromptTemplateContext;
  availableSkills?: SkillDefinition[];
  readTextFile: (path: string) => Promise<string>;
  listAgentHomeMarkdownFiles?: (path: string) => Promise<string[]>;
  cache: SystemPromptCache;
}

export interface SystemPromptResolutionResult {
  systemPrompt: string;
  cacheHit: boolean;
  sources: SystemPromptSourceSummary;
}

export interface SystemPromptSourceSummary {
  basePromptSource: "built-in" | "file" | "text" | "unknown";
  basePromptFile?: string;
  basePromptBuiltIn?: string;
  instructionFiles: string[];
  configuredInstructionFiles: string[];
  agentHomeInstructionFiles: string[];
  workspaceInstructionFile?: string;
  referenceFiles: string[];
  configuredReferenceFiles: string[];
}

interface ResolvedPromptBuildInputs {
  runtimeUsage: PromptTemplateRuntimeUsage;
  promptTemplateContext: PromptTemplateContext;
  instructions: PromptTemplateIncludedFileContext[];
  references: PromptTemplateIncludedFileContext[];
}

export async function resolveSystemPrompt(
  options: SystemPromptResolutionOptions,
): Promise<SystemPromptResolutionResult> {
  const agentHomeMarkdownFiles = await resolveAgentHomeMarkdownFiles(
    options.agent,
    options.listAgentHomeMarkdownFiles ?? defaultListAgentHomeMarkdownFiles,
  );
  const sources = summarizePromptSources(
    options.agent,
    options.promptWorkingDirectory,
    agentHomeMarkdownFiles,
  );
  const promptFileSources = resolvePromptFileSources(
    options.agent,
    options.promptWorkingDirectory,
    agentHomeMarkdownFiles,
  );
  const promptFiles = promptFileSources.map((source) => source.path);

  const staticRuntimeUsage = mergeRuntimeUsages([
    detectRuntimeUsageInPromptSource(options.agent.prompt.base),
    ...(options.agent.prompt.instructions ?? []).map(detectRuntimeUsageInPromptSource),
    ...(options.agent.prompt.references ?? []).map(detectRuntimeUsageInPromptSource),
  ]);
  const cacheKey = await options.cache.buildCacheKey({
    agent: options.agent,
    promptWorkingDirectory: options.promptWorkingDirectory,
    promptFiles,
    templateContext: options.templateContext,
    availableSkills: options.availableSkills,
    runtimeUsage: staticRuntimeUsage,
  });

  const cachedPrompt = options.cache.get(cacheKey);
  if (cachedPrompt !== undefined) {
    return {
      systemPrompt: cachedPrompt,
      cacheHit: true,
      sources,
    };
  }

  const result = await buildSystemPromptWithRuntimeUsage(
    options.agent,
    options.promptWorkingDirectory,
    options.templateContext,
    options.availableSkills ?? [],
    options.readTextFile,
    agentHomeMarkdownFiles,
  );

  const finalCacheKey = staticRuntimeUsageEquals(staticRuntimeUsage, result.runtimeUsage)
    ? cacheKey
    : await options.cache.buildCacheKey({
        agent: options.agent,
        promptWorkingDirectory: options.promptWorkingDirectory,
        promptFiles,
        templateContext: options.templateContext,
        availableSkills: options.availableSkills,
        runtimeUsage: result.runtimeUsage,
      });

  if (!result.runtimeUsage.exactNow) {
    options.cache.set(options.agent.id, finalCacheKey, result.systemPrompt);
  }

  return {
    systemPrompt: result.systemPrompt,
    cacheHit: false,
    sources,
  };
}

function summarizePromptSources(
  agent: AgentDefinition,
  promptWorkingDirectory: string | undefined,
  agentHomeMarkdownFiles: string[],
): SystemPromptSourceSummary {
  const instructionSources = resolveInstructionSources(agent, promptWorkingDirectory, agentHomeMarkdownFiles);
  const instructionFiles = instructionSources
    .map((entry) => entry.source.file)
    .filter((file): file is string => typeof file === "string");
  const configuredInstructionFiles = extractFileSources(agent.prompt.instructions ?? []).map((entry) => entry.path);
  const workspaceInstructionFile = instructionSources.find((entry) => entry.optional)?.source.file;
  const referenceFiles = extractFileSources(agent.prompt.references ?? []).map((entry) => entry.path);

  return {
    ...describeBasePromptSource(agent.prompt.base),
    instructionFiles,
    configuredInstructionFiles,
    agentHomeInstructionFiles: agentHomeMarkdownFiles,
    ...(workspaceInstructionFile ? { workspaceInstructionFile } : {}),
    referenceFiles,
    configuredReferenceFiles: referenceFiles,
  };
}

function describeBasePromptSource(source: PromptSource): Pick<
  SystemPromptSourceSummary,
  "basePromptSource" | "basePromptFile" | "basePromptBuiltIn"
> {
  if (source.file) {
    return {
      basePromptSource: "file",
      basePromptFile: source.file,
    };
  }

  if (source.builtIn) {
    return {
      basePromptSource: "built-in",
      basePromptBuiltIn: source.builtIn,
    };
  }

  if (source.text !== undefined) {
    return {
      basePromptSource: "text",
    };
  }

  return {
    basePromptSource: "unknown",
  };
}

export async function buildSystemPrompt(
  agent: AgentDefinition,
  promptWorkingDirectory: string | undefined,
  templateContext: PromptTemplateContext,
  availableSkills: SkillDefinition[],
  readTextFile: (path: string) => Promise<string>,
  agentHomeMarkdownFiles: string[] = [],
): Promise<string> {
  return (
    await buildSystemPromptWithRuntimeUsage(
      agent,
      promptWorkingDirectory,
      templateContext,
      availableSkills,
      readTextFile,
      agentHomeMarkdownFiles,
    )
  ).systemPrompt;
}

async function buildSystemPromptWithRuntimeUsage(
  agent: AgentDefinition,
  promptWorkingDirectory: string | undefined,
  templateContext: PromptTemplateContext,
  availableSkills: SkillDefinition[],
  readTextFile: (path: string) => Promise<string>,
  agentHomeMarkdownFiles: string[] = [],
): Promise<{ systemPrompt: string; runtimeUsage: PromptTemplateRuntimeUsage }> {
  if (!hasUsablePromptSource(agent.prompt.base)) {
    throw new Error(`Configured base prompt for agent "${agent.id}" must define text, file, or built-in source.`);
  }

  const inputs = await resolvePromptBuildInputs(
    agent,
    promptWorkingDirectory,
    templateContext,
    availableSkills,
    readTextFile,
    agentHomeMarkdownFiles,
  );

  const basePrompt = await resolvePromptSourceContent(agent, agent.prompt.base, readTextFile, {
    kind: "base prompt",
    templateFileContent: true,
    templateContext: inputs.promptTemplateContext,
    runtimeUsage: inputs.runtimeUsage,
  });
  if (!basePrompt) {
    throw new Error(`Configured base prompt for agent "${agent.id}" must define text, file, or built-in source.`);
  }

  return {
    systemPrompt: renderSystemPrompt(
      agent.prompt.base,
      basePrompt,
      inputs.instructions,
      inputs.references,
    ),
    runtimeUsage: inputs.runtimeUsage,
  };
}

async function resolvePromptBuildInputs(
  agent: AgentDefinition,
  promptWorkingDirectory: string | undefined,
  templateContext: PromptTemplateContext,
  availableSkills: SkillDefinition[],
  readTextFile: (path: string) => Promise<string>,
  agentHomeMarkdownFiles: string[],
): Promise<ResolvedPromptBuildInputs> {
  const runtimeUsage = mergeRuntimeUsages([
    detectRuntimeUsageInPromptSource(agent.prompt.base),
    ...(agent.prompt.instructions ?? []).map(detectRuntimeUsageInPromptSource),
    ...(agent.prompt.references ?? []).map(detectRuntimeUsageInPromptSource),
  ]);
  const baseTemplateContext = createBasePromptTemplateContext(
    templateContext,
    availableSkills,
  );

  const instructions = await resolvePromptSections(
    agent,
    resolveInstructionSources(agent, promptWorkingDirectory, agentHomeMarkdownFiles),
    readTextFile,
    "instruction file",
    baseTemplateContext,
    runtimeUsage,
  );
  const references = await resolvePromptSections(
    agent,
    (agent.prompt.references ?? []).map((source) => ({ source, optional: false })),
    readTextFile,
    "reference file",
    baseTemplateContext,
    runtimeUsage,
  );

  return {
    runtimeUsage,
    promptTemplateContext: {
      ...baseTemplateContext,
      prompt: {
        instructions,
        references,
      },
    },
    instructions,
    references,
  };
}

function createBasePromptTemplateContext(
  templateContext: PromptTemplateContext,
  availableSkills: SkillDefinition[],
): PromptTemplateContext {
  return {
    ...templateContext,
    prompt: createEmptyPromptIncludedFiles(),
    skills: mapSkillsToPromptTemplateContext(availableSkills),
  };
}

function renderSystemPrompt(
  basePromptSource: PromptSource,
  basePrompt: string,
  instructions: PromptTemplateIncludedFileContext[],
  references: PromptTemplateIncludedFileContext[],
): string {
  if (!shouldAppendPromptSections(basePromptSource)) {
    return basePrompt;
  }

  const renderedSections = [
    renderPromptSections("INSTRUCTIONS", instructions),
    renderPromptSections("REFERENCE", references),
  ].filter((section) => section.length > 0);

  return [basePrompt, ...renderedSections].join("\n\n");
}

function hasUsablePromptSource(source: PromptSource): boolean {
  return source.text !== undefined || source.file !== undefined || source.builtIn !== undefined;
}

async function resolvePromptSections(
  agent: AgentDefinition,
  sources: Array<{ source: PromptSource; optional: boolean }>,
  readTextFile: (path: string) => Promise<string>,
  kind: "instruction file" | "reference file",
  templateContext: PromptTemplateContext,
  runtimeUsage: PromptTemplateRuntimeUsage,
): Promise<PromptTemplateIncludedFileContext[]> {
  const sections: PromptTemplateIncludedFileContext[] = [];

  for (const source of sources) {
    const content = await resolvePromptSourceContent(agent, source.source, readTextFile, {
      kind,
      optional: source.optional,
      templateFileContent: true,
      templateContext,
      runtimeUsage,
    });
    if (!content) {
      continue;
    }

    sections.push({
      source: describePromptSource(source.source),
      content,
    });
  }

  return sections;
}

function shouldAppendPromptSections(basePrompt: PromptSource): boolean {
  return basePrompt.text !== undefined;
}

export function resolveInstructionSources(
  agent: AgentDefinition,
  promptWorkingDirectory: string | undefined,
  agentHomeMarkdownFiles: string[] = [],
): Array<{ source: PromptSource; optional: boolean }> {
  const sources = dedupeInstructionSources([
    ...resolveAgentHomeInstructionSources(agentHomeMarkdownFiles),
    ...resolveConfiguredInstructionSources(agent),
  ]);
  const seenFiles = new Set(sources.map((entry) => entry.source.file).filter((file): file is string => !!file));

  for (const source of resolveWorkspaceInstructionSources(promptWorkingDirectory)) {
    if (source.source.file && seenFiles.has(source.source.file)) {
      continue;
    }
    if (source.source.file) {
      seenFiles.add(source.source.file);
    }
    sources.push(source);
  }
  return sources;
}

function resolveAgentHomeInstructionSources(
  agentHomeMarkdownFiles: string[],
): Array<{ source: PromptSource; optional: boolean }> {
  return agentHomeMarkdownFiles.map((file) => ({ source: { file }, optional: false }));
}

function resolveConfiguredInstructionSources(
  agent: AgentDefinition,
): Array<{ source: PromptSource; optional: boolean }> {
  return (agent.prompt.instructions ?? []).map((source) => ({ source, optional: false }));
}

function resolveWorkspaceInstructionSources(
  promptWorkingDirectory: string | undefined,
): Array<{ source: PromptSource; optional: boolean }> {
  const workingDirectoryAgentsFile = resolveWorkingDirectoryAgentsFile(promptWorkingDirectory);
  return workingDirectoryAgentsFile ? [{ source: { file: workingDirectoryAgentsFile }, optional: true }] : [];
}

function dedupeInstructionSources(
  sources: Array<{ source: PromptSource; optional: boolean }>,
): Array<{ source: PromptSource; optional: boolean }> {
  const deduped: Array<{ source: PromptSource; optional: boolean }> = [];
  const seenFiles = new Set<string>();

  for (const entry of sources) {
    if (entry.source.file) {
      if (seenFiles.has(entry.source.file)) {
        continue;
      }
      seenFiles.add(entry.source.file);
    }
    deduped.push(entry);
  }

  return deduped;
}

function resolvePromptFileSources(
  agent: AgentDefinition,
  promptWorkingDirectory: string | undefined,
  agentHomeMarkdownFiles: string[],
): Array<{ path: string; optional: boolean }> {
  return [
    ...extractFileSources([agent.prompt.base]),
    ...extractFileSources(agent.prompt.references ?? []),
    ...resolveInstructionSources(agent, promptWorkingDirectory, agentHomeMarkdownFiles)
      .filter((entry) => entry.source.file)
      .map((entry) => ({ path: entry.source.file!, optional: entry.optional })),
  ];
}

async function resolveAgentHomeMarkdownFiles(
  agent: AgentDefinition,
  listAgentHomeMarkdownFiles: (path: string) => Promise<string[]>,
): Promise<string[]> {
  if (!agent.home) {
    return [];
  }

  try {
    return await listAgentHomeMarkdownFiles(agent.home);
  } catch (error) {
    if (isFileNotFoundError(error) || isNotDirectoryError(error)) {
      return [];
    }

    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to list agent home markdown files for agent "${agent.id}": ${agent.home} (${detail})`);
  }
}

async function defaultListAgentHomeMarkdownFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(path, entry.name))
    .sort((left, right) => left.localeCompare(right));
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
    runtimeUsage?: PromptTemplateRuntimeUsage;
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
    recordPromptRuntimeUsage(DEFAULT_AGENT_SYSTEM_PROMPT, options.runtimeUsage);
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
    recordPromptRuntimeUsage(content, options.runtimeUsage);
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

function recordPromptRuntimeUsage(content: string, runtimeUsage: PromptTemplateRuntimeUsage | undefined): void {
  if (!runtimeUsage) {
    return;
  }
  mergeRuntimeUsageInto(runtimeUsage, detectRuntimeUsageInText(content));
}

function detectRuntimeUsageInPromptSource(source: PromptSource): PromptTemplateRuntimeUsage {
  if (source.text !== undefined) {
    return detectRuntimeUsageInText(source.text);
  }
  if (source.builtIn === "default") {
    return detectRuntimeUsageInText(DEFAULT_AGENT_SYSTEM_PROMPT);
  }
  return createEmptyRuntimeUsage();
}

function detectRuntimeUsageInText(content: string): PromptTemplateRuntimeUsage {
  return {
    exactNow: /\bruntime\.now\.(iso|time|local)\b/.test(content),
    minuteNow: /\bruntime\.now\.(timeMinute|localMinute)\b/.test(content),
    dateNow: /\bruntime\.now\.date\b/.test(content),
  };
}

function mergeRuntimeUsages(usages: PromptTemplateRuntimeUsage[]): PromptTemplateRuntimeUsage {
  const result = createEmptyRuntimeUsage();
  for (const usage of usages) {
    mergeRuntimeUsageInto(result, usage);
  }
  return result;
}

function mergeRuntimeUsageInto(target: PromptTemplateRuntimeUsage, source: PromptTemplateRuntimeUsage): void {
  target.exactNow ||= source.exactNow;
  target.minuteNow ||= source.minuteNow;
  target.dateNow ||= source.dateNow;
}

function staticRuntimeUsageEquals(
  left: PromptTemplateRuntimeUsage,
  right: PromptTemplateRuntimeUsage,
): boolean {
  return left.exactNow === right.exactNow && left.minuteNow === right.minuteNow && left.dateNow === right.dateNow;
}

function createEmptyRuntimeUsage(): PromptTemplateRuntimeUsage {
  return {
    exactNow: false,
    minuteNow: false,
    dateNow: false,
  };
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

function isNotDirectoryError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = "code" in error ? error.code : undefined;
  if (code === "ENOTDIR") {
    return true;
  }

  const message = "message" in error ? error.message : undefined;
  return typeof message === "string" && message.includes("ENOTDIR");
}

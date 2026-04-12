import { complete, type AssistantMessage } from "@mariozechner/pi-ai";
import type { AgentDefinition } from "../domain/agent.js";
import { getAssistantText } from "../runtime/message-mapping.js";
import { defaultResolveModel, resolveModelOrThrow, type ModelResolver } from "../runtime/model-resolution.js";
import type { SkillDefinition } from "./types.js";

const SKILL_SELECTION_SYSTEM_PROMPT = [
  "Select the most relevant skills for the user's request.",
  "Use only the provided skill names and descriptions.",
  "Return JSON only in the format {\"skills\":[\"skill-name\"]}.",
  "Return at most the requested number of skills.",
  "If no skill is clearly relevant or you are unsure, return {\"skills\":[]}.",
].join(" ");

export interface SkillSelectionRequest {
  agent: AgentDefinition;
  userText: string;
  catalog: SkillDefinition[];
  maxActivatedSkills?: number;
}

export interface SkillSelector {
  selectRelevantSkills(request: SkillSelectionRequest): Promise<SkillDefinition[]>;
}

interface LlmSkillSelectorDependencies {
  resolveModel?: ModelResolver;
  completeFn?: typeof complete;
  getApiKey?: (
    provider: string,
    agent: AgentDefinition,
  ) => Promise<string | undefined> | string | undefined;
}

export function createLlmSkillSelector(
  dependencies: LlmSkillSelectorDependencies = {},
): SkillSelector {
  const resolveModel = dependencies.resolveModel ?? defaultResolveModel;
  const completeFn = dependencies.completeFn ?? complete;

  return {
    async selectRelevantSkills(request: SkillSelectionRequest): Promise<SkillDefinition[]> {
      const maxActivatedSkills = request.maxActivatedSkills ?? 3;
      if (request.catalog.length === 0 || maxActivatedSkills <= 0) {
        return [];
      }

      const explicitMatches = findExplicitSkillMatches(request.userText, request.catalog).slice(
        0,
        maxActivatedSkills,
      );
      if (explicitMatches.length >= maxActivatedSkills) {
        return explicitMatches;
      }

      const model = resolveModelOrThrow(request.agent, resolveModel);
      const apiKey = await dependencies.getApiKey?.(model.provider, request.agent);
      const response = await completeFn(
        model,
        {
          systemPrompt: SKILL_SELECTION_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: JSON.stringify(
                {
                  userText: request.userText,
                  maxActivatedSkills,
                  skills: request.catalog.map((skill) => ({
                    name: skill.name,
                    description: skill.description,
                  })),
                },
                null,
                2,
              ),
              timestamp: Date.now(),
            },
          ],
        },
        {
          temperature: 0,
          maxTokens: 256,
          ...(apiKey ? { apiKey } : {}),
        },
      );

      const modelSelectedSkills = parseSelectedSkills(
        response,
        request.catalog,
        maxActivatedSkills - explicitMatches.length,
      );

      return deduplicateSelectedSkills([...explicitMatches, ...modelSelectedSkills], maxActivatedSkills);
    },
  };
}

function deduplicateSelectedSkills(skills: SkillDefinition[], maxActivatedSkills: number): SkillDefinition[] {
  const selectedSkills: SkillDefinition[] = [];
  const seenSkillNames = new Set<string>();

  for (const skill of skills) {
    if (selectedSkills.length >= maxActivatedSkills || seenSkillNames.has(skill.name)) {
      continue;
    }

    seenSkillNames.add(skill.name);
    selectedSkills.push(skill);
  }

  return selectedSkills;
}

function parseSelectedSkills(
  response: AssistantMessage,
  catalog: SkillDefinition[],
  maxActivatedSkills: number,
): SkillDefinition[] {
  const responseText = stripCodeFences(getAssistantText(response).trim());
  if (!responseText) {
    throw new Error("skill selector returned an empty response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch (error) {
    throw new Error(`skill selector returned invalid JSON (${formatErrorDetail(error)})`);
  }

  if (!isPlainRecord(parsed) || !Array.isArray(parsed.skills)) {
    throw new Error('skill selector response must be a JSON object with a "skills" array');
  }

  const selectedNames = parsed.skills;
  if (!selectedNames.every((value) => typeof value === "string")) {
    throw new Error('skill selector response "skills" entries must be strings');
  }

  const selectedNameSet = new Set<string>();
  for (const name of selectedNames) {
    if (selectedNameSet.size >= maxActivatedSkills) {
      break;
    }
    selectedNameSet.add(name);
  }

  const catalogByName = new Map(catalog.map((skill) => [skill.name, skill] as const));
  const unknownNames = [...selectedNameSet].filter((name) => !catalogByName.has(name));
  if (unknownNames.length > 0) {
    throw new Error(
      `skill selector returned unknown skills: ${unknownNames.map((name) => `"${name}"`).join(", ")}`,
    );
  }

  return [...selectedNameSet].map((name) => catalogByName.get(name)!);
}

function stripCodeFences(value: string): string {
  const fencedMatch = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch?.[1]?.trim() ?? value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function findExplicitSkillMatches(userText: string, catalog: SkillDefinition[]): SkillDefinition[] {
  const normalizedUserText = normalizeSkillMatchingText(userText);
  if (!normalizedUserText) {
    return [];
  }

  return catalog.filter((skill) => {
    const normalizedSkillName = normalizeSkillMatchingText(skill.name);
    if (!normalizedSkillName) {
      return false;
    }

    const boundaryMatch = new RegExp(`(^| )${escapeRegExp(normalizedSkillName)}( |$)`);
    return boundaryMatch.test(normalizedUserText);
  });
}

function normalizeSkillMatchingText(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

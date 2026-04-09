import type { SkillDefinition } from "./types.js";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "from",
  "help",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "the",
  "to",
  "use",
  "with",
]);

export function selectRelevantSkills(
  userText: string,
  catalog: SkillDefinition[],
  maxActivatedSkills = 3,
): SkillDefinition[] {
  if (catalog.length === 0 || maxActivatedSkills <= 0) {
    return [];
  }

  const normalizedUserText = userText.toLowerCase();
  const userTokens = tokenize(normalizedUserText);
  const scored = catalog
    .map((skill) => ({
      skill,
      score: scoreSkill(skill, normalizedUserText, userTokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name));

  return scored.slice(0, maxActivatedSkills).map((entry) => entry.skill);
}

function scoreSkill(skill: SkillDefinition, normalizedUserText: string, userTokens: Set<string>): number {
  let score = 0;

  if (new RegExp(`(^|[^a-z0-9-])\\$?${escapeRegExp(skill.name)}(?=[^a-z0-9-]|$)`, "i").test(normalizedUserText)) {
    score += 100;
  }

  const nameTokens = skill.name.split("-").filter((token) => token.length > 0);
  const matchedNameTokens = nameTokens.filter((token) => userTokens.has(token)).length;
  if (matchedNameTokens === nameTokens.length && nameTokens.length > 0) {
    score += 30;
  }
  score += matchedNameTokens * 8;

  let matchedDescriptionTokens = 0;
  for (const token of tokenize(skill.description)) {
    if (userTokens.has(token)) {
      matchedDescriptionTokens += 1;
    }
  }

  score += Math.min(matchedDescriptionTokens, 12);

  return score;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

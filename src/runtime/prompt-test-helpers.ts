import { expect } from "vitest";

export interface PromptSectionExpectation {
  source: string;
  content: string;
}

export interface SystemPromptExpectation {
  base: string;
  instructions?: PromptSectionExpectation[];
  references?: PromptSectionExpectation[];
}

export function createInlineBasePrompt(
  base: string,
  options: {
    includeInstructions?: boolean;
    includeReferences?: boolean;
  } = {},
): string {
  const parts = [base];
  if (options.includeInstructions ?? true) {
    parts.push('{{promptSections "INSTRUCTIONS" prompt.instructions}}');
  }
  if (options.includeReferences ?? true) {
    parts.push('{{promptSections "REFERENCE" prompt.references}}');
  }
  return parts.join("\n\n");
}

export function renderPromptSectionForTest(
  tagName: "INSTRUCTIONS" | "REFERENCE",
  source: string,
  content: string,
): string {
  return `<${tagName} from="${source}">\n\n${content}\n</${tagName}>`;
}

export function renderSystemPromptForTest(options: SystemPromptExpectation): string {
  const parts = [options.base];
  for (const instruction of options.instructions ?? []) {
    parts.push(renderPromptSectionForTest("INSTRUCTIONS", instruction.source, instruction.content));
  }
  for (const reference of options.references ?? []) {
    parts.push(renderPromptSectionForTest("REFERENCE", reference.source, reference.content));
  }
  return parts.join("\n\n");
}

export function expectSystemPrompt(
  prompt: string | undefined,
  options: SystemPromptExpectation,
): void {
  expect(prompt).toBeDefined();
  expect(prompt).toBe(renderSystemPromptForTest(options));
}

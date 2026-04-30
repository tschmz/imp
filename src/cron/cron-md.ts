import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import type { AgentCronJob, CronJobDefinition } from "./types.js";
import { parseCronExpression } from "./schedule.js";

const cronFencePattern = /(^|\n)```([^\n`]*)\n([\s\S]*?)\n```/g;
const cronConfigSchema = z.object({
  id: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/),
  enabled: z.boolean().optional(),
  schedule: z.string().min(1),
  timezone: z.string().min(1).optional(),
  reply: z.discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({
      type: z.literal("endpoint"),
      endpointId: z.string().min(1),
      target: z.object({
        conversationId: z.string().min(1),
        userId: z.string().min(1).optional(),
      }),
    }),
  ]),
  session: z.object({
    mode: z.literal("detached"),
    id: z.string().min(1),
    title: z.string().min(1).optional(),
    kind: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  instruction: z.string().min(1).optional(),
}).strict();

type CronConfig = z.infer<typeof cronConfigSchema>;

export interface ParseCronMarkdownResult {
  jobs: CronJobDefinition[];
  issues: string[];
}

interface CronBlock {
  config: CronConfig;
  configStart: number;
  fenceEnd: number;
  nextBlockStart: number;
}

export async function readAgentCronFile(agent: { id: string; home?: string }): Promise<AgentCronJob[]> {
  if (!agent.home) {
    return [];
  }
  const sourceFile = getAgentCronPath(agent.home);
  let content;
  try {
    content = await readFile(sourceFile, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }
  const result = parseCronMarkdown(content);
  if (result.issues.length > 0) {
    throw new Error(result.issues.join("\n"));
  }
  return result.jobs.map((job) => ({
    ...job,
    agentId: agent.id,
    agentHome: agent.home!,
    sourceFile,
  }));
}

export function parseCronMarkdown(content: string): ParseCronMarkdownResult {
  const issues: string[] = [];
  const blocks = findCronBlocks(content, issues);
  const jobs = blocks.flatMap((block, index): CronJobDefinition[] => {
    const body = content.slice(block.fenceEnd, block.nextBlockStart).trim();
    const instruction = (block.config.instruction ?? body).trim();
    if (!instruction) {
      issues.push(`Cron job ${block.config.id} requires an instruction in JSON or Markdown body.`);
      return [];
    }
    try {
      parseCronExpression(block.config.schedule);
      if (block.config.timezone) {
        new Intl.DateTimeFormat("en", { timeZone: block.config.timezone }).format(new Date());
      }
    } catch (error) {
      issues.push(`Cron job ${block.config.id || index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
    return [{
      id: block.config.id,
      enabled: block.config.enabled ?? true,
      schedule: block.config.schedule,
      ...(block.config.timezone ? { timezone: block.config.timezone } : {}),
      reply: block.config.reply,
      session: block.config.session,
      instruction,
    }];
  });

  const seen = new Set<string>();
  for (const job of jobs) {
    if (seen.has(job.id)) {
      issues.push(`Duplicate cron job id: ${job.id}`);
    }
    seen.add(job.id);
  }

  return { jobs: issues.length > 0 ? [] : jobs, issues };
}

export async function upsertAgentCronJob(agentHome: string, job: CronJobDefinition): Promise<void> {
  validateCronJob(job);
  const path = getAgentCronPath(agentHome);
  let existing = "# Imp Cron\n";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const parsed = parseCronMarkdown(existing);
  if (parsed.issues.length > 0) {
    throw new Error(parsed.issues.join("\n"));
  }
  const next = renderCronMarkdown(upsertJob(parsed.jobs, job));
  await writeFile(path, next, "utf8");
}

export async function deleteAgentCronJob(agentHome: string, jobId: string): Promise<boolean> {
  const path = getAgentCronPath(agentHome);
  let existing;
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
  const parsed = parseCronMarkdown(existing);
  if (parsed.issues.length > 0) {
    throw new Error(parsed.issues.join("\n"));
  }
  const nextJobs = parsed.jobs.filter((job) => job.id !== jobId);
  if (nextJobs.length === parsed.jobs.length) {
    return false;
  }
  await writeFile(path, renderCronMarkdown(nextJobs), "utf8");
  return true;
}

export function renderCronMarkdown(jobs: CronJobDefinition[]): string {
  const lines = ["# Imp Cron", ""];
  for (const job of jobs) {
    const { instruction, ...config } = job;
    lines.push(`## ${job.id}`, "", "```json imp-cron", JSON.stringify(config, null, 2), "```", "", instruction.trim(), "");
  }
  return `${lines.join("\n").trim()}\n`;
}

export function getAgentCronPath(agentHome: string): string {
  return join(agentHome, "cron.md");
}

function validateCronJob(job: CronJobDefinition): void {
  parseCronExpression(job.schedule);
  if (job.timezone) {
    new Intl.DateTimeFormat("en", { timeZone: job.timezone }).format(new Date());
  }
  if (!job.instruction.trim()) {
    throw new Error(`Cron job ${job.id} requires a non-empty instruction.`);
  }
}

function findCronBlocks(content: string, issues: string[]): CronBlock[] {
  const matches = [...content.matchAll(cronFencePattern)].filter((match) => isCronFence(match[2] ?? ""));
  return matches.flatMap((match, index): CronBlock[] => {
    const configStart = match.index ?? 0;
    const fenceEnd = configStart + match[0].length;
    const nextBlockStart = index + 1 < matches.length ? matches[index + 1]!.index! : content.length;
    try {
      const parsed = JSON.parse(match[3] ?? "");
      const config = cronConfigSchema.parse(parsed);
      return [{ config, configStart, fenceEnd, nextBlockStart }];
    } catch (error) {
      issues.push(`Invalid cron JSON block near offset ${configStart}: ${renderParseError(error)}`);
      return [];
    }
  });
}

function isCronFence(info: string): boolean {
  const words = info.trim().split(/\s+/).filter(Boolean);
  return words.includes("json") && words.includes("imp-cron");
}

function renderParseError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

function upsertJob(jobs: CronJobDefinition[], job: CronJobDefinition): CronJobDefinition[] {
  const index = jobs.findIndex((candidate) => candidate.id === job.id);
  if (index < 0) {
    return [...jobs, job];
  }
  return jobs.map((candidate, candidateIndex) => candidateIndex === index ? job : candidate);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}

export function isAgentCronFile(path: string): boolean {
  return basename(path) === "cron.md";
}

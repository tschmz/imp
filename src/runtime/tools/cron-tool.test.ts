import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentDefinition } from "../../domain/agent.js";
import type { IncomingMessage } from "../../domain/message.js";
import { parseCronMarkdown } from "../../cron/cron-md.js";
import { createCronTool } from "./cron-tool.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("cron tool", () => {
  it("guides agents to keep scheduled instructions task-specific", () => {
    const [tool] = createCronTool(createAgent({ home: "/tmp/agent" }));
    const parameters = tool!.parameters as {
      properties: {
        job: {
          properties: {
            instruction: { description: string };
          };
        };
      };
    };

    expect(tool!.description).toContain("future scheduled user message");
    expect(parameters.properties.job.properties.instruction.description).toContain("Do not copy or restate");
    expect(parameters.properties.job.properties.instruction.description).toContain("system prompt");
    expect(parameters.properties.job.properties.instruction.description).toContain("concrete recurring task");
  });

  it("defaults cron session mode to attached when omitted", async () => {
    const root = await createTempDir();
    const [tool] = createCronTool(createAgent({ home: root }));

    await tool!.execute("call-1", createUpsertParams({
      session: {
        title: "Daily report",
      },
    }));

    const parsed = parseCronMarkdown(await readFile(join(root, "cron.md"), "utf8"));

    expect(parsed.issues).toEqual([]);
    expect(parsed.jobs[0]?.session).toEqual({
      mode: "attached",
      id: "daily-report",
      title: "Daily report",
    });
  });

  it("resolves current replies to the current endpoint conversation before saving", async () => {
    const root = await createTempDir();
    const [tool] = createCronTool(createAgent({ home: root }), createIncomingMessage());

    await tool!.execute("call-1", createUpsertParams({
      reply: { type: "current" },
    }));

    const parsed = parseCronMarkdown(await readFile(join(root, "cron.md"), "utf8"));

    expect(parsed.issues).toEqual([]);
    expect(parsed.jobs[0]?.reply).toEqual({
      type: "endpoint",
      endpointId: "private-telegram",
      target: {
        conversationId: "42",
        userId: "7",
      },
    });
  });

  it("rejects current replies when no current endpoint conversation is available", async () => {
    const root = await createTempDir();
    const [tool] = createCronTool(createAgent({ home: root }));

    await expect(
      tool!.execute("call-1", createUpsertParams({
        reply: { type: "current" },
      })),
    ).rejects.toThrow("job.reply.type current requires a current endpoint conversation");
  });

  it("rejects current replies from scheduled cron messages", async () => {
    const root = await createTempDir();
    const [tool] = createCronTool(createAgent({ home: root }), {
      ...createIncomingMessage(),
      endpointId: "cron",
      conversation: {
        transport: "cron",
        externalId: "cron:default:daily-report",
      },
      userId: "cron",
    });

    await expect(
      tool!.execute("call-1", createUpsertParams({
        reply: { type: "current" },
      })),
    ).rejects.toThrow("job.reply.type current requires a current endpoint conversation");
  });
});

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-cron-tool-test-"));
  tempDirs.push(path);
  return path;
}

function createAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "default",
    name: "Default",
    prompt: {
      base: { text: "You are concise." },
    },
    model: {
      provider: "test",
      modelId: "stub",
    },
    tools: ["cron"],
    extensions: [],
    ...overrides,
  };
}

function createIncomingMessage(): IncomingMessage {
  return {
    endpointId: "private-telegram",
    conversation: {
      transport: "telegram",
      externalId: "42",
    },
    messageId: "1",
    correlationId: "corr-1",
    userId: "7",
    text: "schedule this",
    receivedAt: "2026-04-05T00:00:00.000Z",
  };
}

function createUpsertParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "upsert",
    job: {
      id: "daily-report",
      enabled: true,
      schedule: "0 8 * * *",
      reply: { type: "none" },
      session: {
        mode: "detached",
        id: "daily-report",
      },
      instruction: "Run the daily report.",
      ...overrides,
    },
  };
}

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  executePhoneCallTool,
  executePhoneHangupTool,
  loadPhoneToolConfig,
} from "../lib/mcp-tools.mjs";
import { writeJsonAtomic } from "../lib/files.mjs";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("imp-phone MCP tools", () => {
  it("loads agent phone contacts and writes a call request", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-phone-mcp-"));
    tempDirs.push(root);
    const configPath = await writeImpConfig(root);
    const requestsDir = join(root, "requests");
    const config = await loadPhoneToolConfig({
      configPath,
      agentId: "default",
      requestsDir,
      pollIntervalMs: 10,
      timeoutMs: 1000,
    });

    const promise = executePhoneCallTool(config, {
      contactId: "office",
      purpose: "Ask about the appointment.",
    });
    const request = await readFirstRequest(requestsDir);

    expect(request.payload).toMatchObject({
      contact: {
        id: "office",
        name: "Office",
        uri: "sip:office@example.com",
        comment: "work colleague",
      },
      agentId: "default",
      purpose: "Ask about the appointment.",
    });

    await writeJsonAtomic(request.payload.resultPath, {
      schemaVersion: 1,
      requestId: request.payload.id,
      conversationId: "imp-phone-call-1",
      status: "answered",
    });

    const result = await promise;
    expect(result.content[0].text).toContain("Phone call to Office (office) was answered.");
    expect(result.content[0].text).toContain("Conversation id: imp-phone-call-1.");
    expect(result.structuredContent).toMatchObject({
      contactId: "office",
      contactName: "Office",
      contactComment: "work colleague",
      requestsDir,
      callResult: {
        status: "answered",
        conversationId: "imp-phone-call-1",
      },
    });
  });

  it("writes hangup control commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-phone-mcp-"));
    tempDirs.push(root);
    const configPath = await writeImpConfig(root);
    const controlDir = join(root, "control");
    const config = await loadPhoneToolConfig({
      configPath,
      agentId: "default",
      requestsDir: join(root, "requests"),
      controlDir,
    });

    const result = await executePhoneHangupTool(config, {
      reason: "conversation complete",
    });
    const files = await readdir(controlDir);
    const payload = JSON.parse(await readFile(join(controlDir, files[0]), "utf8"));

    expect(result.content[0].text).toContain("Phone hangup requested.");
    expect(result.structuredContent).toMatchObject({
      controlDir,
      reason: "conversation complete",
    });
    expect(payload).toMatchObject({
      schemaVersion: 1,
      type: "hangup",
      agentId: "default",
      reason: "conversation complete",
    });
  });
});

async function writeImpConfig(root) {
  const configPath = join(root, "config.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        instance: {
          name: "test",
        },
        paths: {
          dataRoot: "./state",
        },
        defaults: {
          agentId: "default",
        },
        agents: [
          {
            id: "default",
            model: {
              provider: "openai",
              modelId: "gpt-5.4",
            },
            tools: {
              mcp: {
                servers: ["imp-phone"],
              },
              phone: {
                contacts: [
                  {
                    id: "office",
                    name: "Office",
                    uri: "sip:office@example.com",
                    comment: "work colleague",
                  },
                ],
              },
            },
          },
        ],
        endpoints: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return configPath;
}

async function readFirstRequest(requestsDir) {
  for (let attempts = 0; attempts < 100; attempts += 1) {
    const files = await readdir(requestsDir).catch(() => []);
    const requestFile = files.find((file) => file.endsWith(".json"));
    if (requestFile) {
      const path = join(requestsDir, requestFile);
      return {
        path,
        payload: JSON.parse(await readFile(path, "utf8")),
      };
    }
    await sleep(10);
  }
  throw new Error(`No call request written in ${requestsDir}.`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

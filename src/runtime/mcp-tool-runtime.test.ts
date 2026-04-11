import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "../domain/agent.js";
import type { Logger } from "../logging/types.js";
import { resolveMcpTools } from "./mcp-tool-runtime.js";

const fixturePath = fileURLToPath(new URL("./fixtures/echo-mcp-server.mjs", import.meta.url));

describe("resolveMcpTools", () => {
  it("loads tools from a local stdio MCP server and prefixes their names with the server id", async () => {
    const resolution = await resolveMcpTools(createAgent({
      mcp: {
        servers: [
          {
            id: "echo",
            command: process.execPath,
            args: [fixturePath],
          },
        ],
      },
    }));

    expect(resolution.initializedServerIds).toEqual(["echo"]);
    expect(resolution.failedServerIds).toEqual([]);

    try {
      expect(resolution.tools.map((tool) => tool.name).sort()).toEqual(["echo__fail", "echo__say"]);

      const say = resolution.tools.find((tool) => tool.name === "echo__say");
      expect(say).toBeDefined();

      await expect(say!.execute("1", { text: "hello" })).resolves.toMatchObject({
        content: [{ type: "text", text: "echo:hello" }],
        details: {
          serverId: "echo",
          toolName: "say",
          structuredContent: {
            echoed: "hello",
          },
        },
      });

      const fail = resolution.tools.find((tool) => tool.name === "echo__fail");
      await expect(fail!.execute("2", {})).rejects.toThrow("forced failure");
    } finally {
      await resolution.close();
    }
  });

  it("logs MCP startup failures and skips the broken server", async () => {
    const logger = createMockLogger();

    const resolution = await resolveMcpTools(
      createAgent({
        mcp: {
          servers: [
            {
              id: "missing",
              command: "/definitely/not/a/real/executable",
            },
          ],
        },
      }),
      { logger },
    );

    try {
      expect(resolution.tools).toEqual([]);
      expect(resolution.initializedServerIds).toEqual([]);
      expect(resolution.failedServerIds).toEqual(["missing"]);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        'failed to initialize MCP server "missing" for agent "default"',
        undefined,
        expect.any(Error),
      );
    } finally {
      await resolution.close();
    }
  });
});

function createAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "default",
    name: "default",
    prompt: {
      base: {
        text: "You are concise.",
      },
    },
    model: {
      provider: "openai",
      modelId: "gpt-5.4",
    },
    tools: [],
    extensions: [],
    ...overrides,
  };
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(async () => {}),
    info: vi.fn(async () => {}),
    error: vi.fn(async () => {}),
  };
}

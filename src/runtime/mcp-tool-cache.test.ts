import { describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "../domain/agent.js";
import type { ToolDefinition } from "../tools/types.js";
import { createMcpToolCache } from "./mcp-tool-cache.js";
import type { ResolvedMcpTools } from "./mcp-tool-runtime.js";

describe("createMcpToolCache", () => {
  it("retries MCP servers after a cached initialization result reports failure", async () => {
    const firstClose = vi.fn(async () => {});
    const secondClose = vi.fn(async () => {});
    const resolveMcpTools = vi
      .fn<Parameters<typeof createMcpToolCache>[0]["resolveMcpTools"]>()
      .mockResolvedValueOnce(createResolution({
        failedServerIds: ["flaky"],
        close: firstClose,
      }))
      .mockResolvedValueOnce(createResolution({
        tools: [createTool("flaky__status")],
        initializedServerIds: ["flaky"],
        close: secondClose,
      }));
    const cache = createMcpToolCache({ resolveMcpTools });

    const first = await cache.resolve(createAgent());
    expect(first.failedServerIds).toEqual(["flaky"]);
    expect(first.tools).toEqual([]);

    const second = await cache.resolve(createAgent());
    expect(second.initializedServerIds).toEqual(["flaky"]);
    expect(second.failedServerIds).toEqual([]);
    expect(second.tools.map((tool) => tool.name)).toEqual(["flaky__status"]);
    expect(resolveMcpTools).toHaveBeenCalledTimes(2);

    await cache.close();
    expect(firstClose).not.toHaveBeenCalled();
    expect(secondClose).toHaveBeenCalledTimes(1);
  });

  it("reuses successfully initialized MCP server runtimes", async () => {
    const close = vi.fn(async () => {});
    const resolveMcpTools = vi
      .fn<Parameters<typeof createMcpToolCache>[0]["resolveMcpTools"]>()
      .mockResolvedValue(createResolution({
        tools: [createTool("stable__status")],
        initializedServerIds: ["stable"],
        close,
      }));
    const cache = createMcpToolCache({ resolveMcpTools });

    await cache.resolve(createAgent("stable"));
    await cache.resolve(createAgent("stable"));

    expect(resolveMcpTools).toHaveBeenCalledTimes(1);
    await cache.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps filtered MCP server runtimes separate in the cache", async () => {
    const resolveMcpTools = vi
      .fn<Parameters<typeof createMcpToolCache>[0]["resolveMcpTools"]>()
      .mockResolvedValueOnce(createResolution({
        tools: [createTool("stable__status")],
        initializedServerIds: ["stable"],
      }))
      .mockResolvedValueOnce(createResolution({
        tools: [createTool("stable__health")],
        initializedServerIds: ["stable"],
      }));
    const cache = createMcpToolCache({ resolveMcpTools });

    const first = await cache.resolve(createAgent({
      id: "stable",
      command: "node",
      toolFilter: {
        include: ["status"],
      },
    }));
    const second = await cache.resolve(createAgent({
      id: "stable",
      command: "node",
      toolFilter: {
        include: ["health"],
      },
    }));

    expect(resolveMcpTools).toHaveBeenCalledTimes(2);
    expect(first.tools.map((tool) => tool.name)).toEqual(["stable__status"]);
    expect(second.tools.map((tool) => tool.name)).toEqual(["stable__health"]);

    await cache.close();
  });

  it("does not cache HTTP MCP server runtimes", async () => {
    const firstClose = vi.fn(async () => {});
    const secondClose = vi.fn(async () => {});
    const resolveMcpTools = vi
      .fn<Parameters<typeof createMcpToolCache>[0]["resolveMcpTools"]>()
      .mockResolvedValueOnce(createResolution({
        tools: [createTool("remote__status")],
        initializedServerIds: ["remote"],
        close: firstClose,
      }))
      .mockResolvedValueOnce(createResolution({
        tools: [createTool("remote__status")],
        initializedServerIds: ["remote"],
        close: secondClose,
      }));
    const cache = createMcpToolCache({ resolveMcpTools });
    const agent = createAgent({
      id: "remote",
      transport: "http",
      url: "https://mcp.example.test/mcp",
    });

    const first = await cache.resolve(agent);
    const second = await cache.resolve(agent);

    expect(resolveMcpTools).toHaveBeenCalledTimes(2);
    expect(first.tools.map((tool) => tool.name)).toEqual(["remote__status"]);
    expect(second.tools.map((tool) => tool.name)).toEqual(["remote__status"]);

    await first.close();
    await second.close();
    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(secondClose).toHaveBeenCalledTimes(1);

    await cache.close();
    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(secondClose).toHaveBeenCalledTimes(1);
  });
});

function createAgent(
  server: string | NonNullable<AgentDefinition["mcp"]>["servers"][number] = "flaky",
): AgentDefinition {
  const mcpServer = typeof server === "string"
    ? {
        id: server,
        command: "node",
      }
    : server;

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
      modelId: "gpt-5.5",
    },
    tools: [],
    extensions: [],
    mcp: {
      servers: [mcpServer],
    },
  };
}

function createResolution(overrides: Partial<ResolvedMcpTools> = {}): ResolvedMcpTools {
  return {
    tools: [],
    initializedServerIds: [],
    failedServerIds: [],
    async close() {},
    ...overrides,
  };
}

function createTool(name: string): ToolDefinition {
  return {
    name,
    label: name,
    description: "Test tool",
    parameters: {
      type: "object",
      properties: {},
    },
    async execute() {
      return {
        content: [{ type: "text", text: "ok" }],
        details: {},
      };
    },
  };
}

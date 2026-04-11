import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport, type StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolDefinition } from "../tools/types.js";
import type { AgentDefinition } from "../domain/agent.js";
import type { Logger } from "../logging/types.js";

interface McpListedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | {
      type: "resource";
      resource:
        | { uri: string; text: string; mimeType?: string }
        | { uri: string; blob: string; mimeType?: string };
    }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      mimeType?: string;
      description?: string;
      title?: string;
    };

interface McpCallToolSuccess {
  content: McpContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

interface McpCallToolCompatibilityResult {
  toolResult: unknown;
}

interface McpClientLike {
  connect(transport: unknown): Promise<void>;
  listTools(params?: {
    cursor?: string;
  }): Promise<{
    tools: McpListedTool[];
    nextCursor?: string;
  }>;
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<McpCallToolSuccess | McpCallToolCompatibilityResult>;
  close(): Promise<void>;
}

interface McpToolRuntimeDependencies {
  createClient?: () => McpClientLike;
  createTransport?: (server: StdioServerParameters) => unknown;
}

export interface ResolvedMcpTools {
  tools: ToolDefinition[];
  initializedServerIds: string[];
  failedServerIds: string[];
  close(): Promise<void>;
}

const MCP_CLIENT_INFO = {
  name: "imp",
  version: "0.1.0",
} as const;

export async function resolveMcpTools(
  agent: AgentDefinition,
  options: {
    logger?: Logger;
  } & McpToolRuntimeDependencies = {},
): Promise<ResolvedMcpTools> {
  const servers = agent.mcp?.servers ?? [];
  if (servers.length === 0) {
    return createEmptyResolution();
  }

  const createClient = options.createClient ?? createDefaultClient;
  const createTransport = options.createTransport ?? createDefaultTransport;
  const clients: McpClientLike[] = [];
  const tools: ToolDefinition[] = [];
  const initializedServerIds: string[] = [];
  const failedServerIds: string[] = [];

  for (const server of servers) {
    const client = createClient();
    const transport = createTransport({
      command: server.command,
      ...(server.args ? { args: server.args } : {}),
      ...(server.env ? { env: server.env } : {}),
      ...(server.cwd ? { cwd: server.cwd } : {}),
      stderr: "pipe",
    });

    try {
      await client.connect(transport);
      const listedTools = await listAllTools(client);

      for (const tool of listedTools) {
        tools.push(createMcpToolDefinition(server.id, tool, client));
      }

      clients.push(client);
      initializedServerIds.push(server.id);
      await options.logger?.debug(
        `initialized MCP server "${server.id}" for agent "${agent.id}"`,
      );
    } catch (error) {
      failedServerIds.push(server.id);
      await safeCloseClient(client);
      await options.logger?.error(
        `failed to initialize MCP server "${server.id}" for agent "${agent.id}"`,
        undefined,
        error,
      );
    }
  }

  return {
    tools,
    initializedServerIds,
    failedServerIds,
    async close() {
      await Promise.all(clients.map(async (client) => safeCloseClient(client)));
    },
  };
}

function createDefaultClient(): McpClientLike {
  return new Client(MCP_CLIENT_INFO);
}

function createDefaultTransport(server: StdioServerParameters): unknown {
  return new StdioClientTransport(server);
}

function createEmptyResolution(): ResolvedMcpTools {
  return {
    tools: [],
    initializedServerIds: [],
    failedServerIds: [],
    async close() {},
  };
}

async function listAllTools(client: McpClientLike): Promise<McpListedTool[]> {
  const tools: McpListedTool[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...response.tools);
    cursor = response.nextCursor;
  } while (cursor);

  return tools;
}

function createMcpToolDefinition(
  serverId: string,
  tool: McpListedTool,
  client: McpClientLike,
): ToolDefinition {
  const prefixedName = `${serverId}__${tool.name}`;

  return {
    name: prefixedName,
    label: tool.title ?? prefixedName,
    description: tool.description ?? `Tool imported from MCP server "${serverId}".`,
    parameters: normalizeToolSchema(tool.inputSchema),
    async execute(_toolCallId, params) {
      const result = await client.callTool({
        name: tool.name,
        ...(isRecord(params) ? { arguments: params } : {}),
      });

      if ("toolResult" in result) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.toolResult, null, 2),
            },
          ],
          details: {
            serverId,
            toolName: tool.name,
            toolResult: result.toolResult,
          },
        };
      }

      if (result.isError) {
        throw new Error(getErrorMessage(result.content, prefixedName));
      }

      return {
        content: mapContentBlocks(result.content),
        details: {
          serverId,
          toolName: tool.name,
          ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
        },
      };
    },
  };
}

function normalizeToolSchema(inputSchema: Record<string, unknown> | undefined): ToolDefinition["parameters"] {
  return ((inputSchema && typeof inputSchema === "object"
    ? inputSchema
    : {
        type: "object",
        properties: {},
        additionalProperties: true,
      }) as ToolDefinition["parameters"]);
}

function mapContentBlocks(content: McpContentBlock[]): Array<
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
> {
  const mapped: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  > = [];

  for (const block of content) {
    switch (block.type) {
      case "text":
        mapped.push({ type: "text", text: block.text });
        break;
      case "image":
        mapped.push({ type: "image", data: block.data, mimeType: block.mimeType });
        break;
      case "audio":
        mapped.push({
          type: "text",
          text: `[audio output omitted: ${block.mimeType}]`,
        });
        break;
      case "resource":
        if ("text" in block.resource) {
          mapped.push({ type: "text", text: block.resource.text });
          break;
        }

        mapped.push({
          type: "text",
          text: `[resource blob omitted: ${block.resource.uri}]`,
        });
        break;
      case "resource_link":
        mapped.push({
          type: "text",
          text: block.uri,
        });
        break;
    }
  }

  return mapped;
}

function getErrorMessage(content: McpContentBlock[], prefixedToolName: string): string {
  const text = content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();

  return text.length > 0 ? text : `MCP tool "${prefixedToolName}" failed.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function safeCloseClient(client: McpClientLike): Promise<void> {
  try {
    await client.close();
  } catch {
    // Ignore shutdown errors so runtime cleanup does not mask prior failures.
  }
}

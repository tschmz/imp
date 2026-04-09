import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

const server = new McpServer({
  name: "echo-mcp-server",
  version: "1.0.0",
});

server.registerTool(
  "say",
  {
    description: "Echo text back to the caller.",
    inputSchema: z.object({
      text: z.string(),
    }),
  },
  async ({ text }) => ({
    content: [{ type: "text", text: `echo:${text}` }],
    structuredContent: {
      echoed: text,
    },
  }),
);

server.registerTool(
  "fail",
  {
    description: "Return an MCP tool error.",
    inputSchema: z.object({}),
  },
  async () => ({
    content: [{ type: "text", text: "forced failure" }],
    isError: true,
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);

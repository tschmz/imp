import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import {
  executePhoneCallTool,
  executePhoneHangupTool,
} from "./mcp-tools.mjs";

export function createPhoneMcpServer(config) {
  const server = new McpServer({
    name: "imp-phone",
    version: "0.1.2",
  });
  const contactIds = config.contacts.map((contact) => contact.id);

  server.registerTool(
    "phone_call",
    {
      title: "phone_call",
      description:
        `Start an allowlisted SIP phone call through the imp-phone controller. ` +
        `Allowed contacts: ${config.contacts.map(formatContactForDescription).join(", ")}.`,
      inputSchema: z.object({
        contactId: z.enum(contactIds).describe("Exact id of the allowed phone contact to call."),
        purpose: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Detailed prompt for the AI agent that will conduct the phone call. Include the reason for the call, relevant context, desired outcome, and important constraints.",
          ),
      }),
    },
    async (params) => toMcpToolResult(executePhoneCallTool(config, params)),
  );

  server.registerTool(
    "phone_hangup",
    {
      title: "phone_hangup",
      description:
        "End the currently active imp-phone call. Use this after a brief goodbye when the phone conversation is done.",
      inputSchema: z.object({
        reason: z
          .string()
          .min(1)
          .optional()
          .describe("Optional short reason for ending the current phone call."),
      }),
    },
    async (params) => toMcpToolResult(executePhoneHangupTool(config, params)),
  );

  return server;
}

async function toMcpToolResult(promise) {
  try {
    return await promise;
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : String(error),
        },
      ],
      isError: true,
    };
  }
}

function formatContactForDescription(contact) {
  return `${contact.id} (${contact.name}${contact.comment ? `, ${contact.comment}` : ""})`;
}

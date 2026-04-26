#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPhoneMcpServer } from "../lib/mcp-server.mjs";
import { loadPhoneToolConfig, parseMcpServerArgs } from "../lib/mcp-tools.mjs";

function printHelp() {
  console.log(`Usage: imp-phone-mcp-server --config CONFIG --agent-id AGENT [--requests-dir DIR] [--control-dir DIR] [--timeout-ms MS]

Exposes imp-phone phone_call and phone_hangup tools over MCP stdio.`);
}

try {
  const args = parseMcpServerArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const config = await loadPhoneToolConfig(args);
  const server = createPhoneMcpServer(config);
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

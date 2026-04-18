#!/usr/bin/env node
import { loadConfig } from "../lib/config.mjs";
import { writeIngressEvent } from "../lib/events.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.config || !args.text) {
  console.error("Usage: imp-voice-write-event --config <path> --text <text>");
  process.exit(2);
}

const config = await loadConfig(args.config);
const path = await writeIngressEvent(config, {
  text: args.text,
  conversationId: args.conversationId,
  userId: args.userId,
  metadata: {
    mode: "manual",
  },
});
console.log(`Wrote ${path}`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      parsed.config = argv[++index];
    } else if (arg === "--text") {
      parsed.text = argv[++index];
    } else if (arg === "--conversation-id") {
      parsed.conversationId = argv[++index];
    } else if (arg === "--user-id") {
      parsed.userId = argv[++index];
    }
  }
  return parsed;
}

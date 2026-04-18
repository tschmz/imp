#!/usr/bin/env node
import { loadConfig } from "../lib/config.mjs";
import { SpeakerOutboxConsumer } from "../lib/speaker.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.config) {
  console.error("Usage: imp-voice-out --config <path> [--once] [--render-only]");
  process.exit(2);
}

const config = await loadConfig(args.config);
const consumer = new SpeakerOutboxConsumer(config, {
  once: args.once,
  playAudio: !args.renderOnly,
  log: (message) => console.log(`[${new Date().toISOString()}] ${message}`),
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

process.exitCode = await consumer.run();

function parseArgs(argv) {
  const parsed = {
    once: false,
    renderOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      parsed.config = argv[++index];
    } else if (arg === "--once") {
      parsed.once = true;
    } else if (arg === "--render-only") {
      parsed.renderOnly = true;
    }
  }
  return parsed;
}

#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "../lib/config.mjs";
import { writeIngressEvent } from "../lib/events.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.config) {
  console.error("Usage: imp-voice-text-ingress --config <path>");
  process.exit(2);
}

const config = await loadConfig(args.config);
const rl = createInterface({ input, output, terminal: input.isTTY });
console.log("imp-voice text ingress ready. Enter one message per line.");

for await (const line of rl) {
  const text = line.trim();
  if (!text) {
    continue;
  }

  try {
    const path = await writeIngressEvent(config, {
      text,
      metadata: {
        mode: "text-ingress",
      },
    });
    console.log(`Wrote ${path}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--config") {
      parsed.config = argv[++index];
    }
  }
  return parsed;
}

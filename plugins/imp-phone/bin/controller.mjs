#!/usr/bin/env node
import { loadConfig } from "../lib/config.mjs";
import { PhoneController } from "../lib/controller.mjs";

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      parsed.config = argv[++index];
    } else if (arg === "--once") {
      parsed.once = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: imp-phone-controller --config config/default.json [--once]

Consumes call request files and runs turn-based phone conversations through imp.`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (!args.config) {
    throw new Error("--config is required.");
  }

  const controller = new PhoneController(await loadConfig(args.config), {
    once: args.once,
  });
  process.on("SIGTERM", () => controller.stop());
  process.on("SIGINT", () => controller.stop());
  process.exit(await controller.run());
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
}

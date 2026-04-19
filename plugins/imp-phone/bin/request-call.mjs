#!/usr/bin/env node
import { parseRequestCliArgs, writeCallRequest } from "../lib/requests.mjs";

function printHelp() {
  console.log(`Usage: imp-phone-request-call --requests-dir DIR --contact-id ID --contact-name NAME --uri URI [--comment TEXT] [--purpose TEXT] [--agent-id ID]

Writes a call request JSON file for the imp-phone controller.`);
}

try {
  const args = parseRequestCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const path = await writeCallRequest(args);
  console.log(path);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

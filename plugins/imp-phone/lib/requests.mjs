import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic, sanitizeFileName } from "./files.mjs";

export async function writeCallRequest(options) {
  const requestsDir = requiredString(options.requestsDir, "requestsDir");
  const resultsDir = optionalString(options.resultsDir, "resultsDir") ?? join(requestsDir, "results");
  const contactId = requiredString(options.contactId, "contactId");
  const contactName = requiredString(options.contactName ?? options.name, "contactName");
  const uri = requiredString(options.uri, "uri");
  const agentId = optionalString(options.agentId ?? process.env.IMP_PHONE_AGENT_ID, "agentId");
  const comment = optionalString(options.comment ?? process.env.IMP_PHONE_CONTACT_COMMENT, "comment");
  const requestId = options.id ?? `call-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const fileName = `${sanitizeFileName(requestId)}-${process.hrtime.bigint().toString()}.json`;
  const path = join(requestsDir, fileName);
  const resultPath = join(resultsDir, `${sanitizeFileName(requestId)}.json`);
  const payload = {
    schemaVersion: 1,
    id: requestId,
    correlationId: options.correlationId ?? randomUUID(),
    resultPath,
    contact: {
      id: contactId,
      name: contactName,
      uri,
      ...(comment ? { comment } : {}),
    },
    ...(agentId ? { agentId } : {}),
    purpose: typeof options.purpose === "string" && options.purpose.length > 0 ? options.purpose : undefined,
    requestedAt: new Date().toISOString(),
  };

  await writeJsonAtomic(path, payload);
  if (options.wait) {
    return await waitForCallRequestResult(resultPath, options.pollIntervalMs);
  }
  return path;
}

export function parseRequestCliArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--requests-dir") {
      parsed.requestsDir = argv[++index];
    } else if (arg === "--results-dir") {
      parsed.resultsDir = argv[++index];
    } else if (arg === "--contact-id") {
      parsed.contactId = argv[++index];
    } else if (arg === "--contact-name" || arg === "--name") {
      parsed.contactName = argv[++index];
    } else if (arg === "--uri") {
      parsed.uri = argv[++index];
    } else if (arg === "--comment") {
      parsed.comment = argv[++index];
    } else if (arg === "--purpose") {
      parsed.purpose = argv[++index];
    } else if (arg === "--agent-id") {
      parsed.agentId = argv[++index];
    } else if (arg === "--id") {
      parsed.id = argv[++index];
    } else if (arg === "--correlation-id") {
      parsed.correlationId = argv[++index];
    } else if (arg === "--wait") {
      parsed.wait = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function waitForCallRequestResult(resultPath, pollIntervalMs = 250) {
  while (true) {
    try {
      return JSON.parse(await readFile(resultPath, "utf8"));
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
      await sleep(pollIntervalMs);
    }
  }
}

function isMissingFileError(error) {
  return typeof error === "object" && error !== null && error.code === "ENOENT";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value, name) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string when provided.`);
  }
  return value;
}

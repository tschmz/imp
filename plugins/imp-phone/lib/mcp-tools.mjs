import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { writeJsonAtomic, sanitizeFileName } from "./files.mjs";
import { writeCallRequest } from "./requests.mjs";

export async function loadPhoneToolConfig(options = {}) {
  const configPath = optionalString(options.configPath ?? process.env.IMP_CONFIG_PATH, "configPath");
  const agentId = optionalString(
    options.agentId ?? process.env.IMP_PHONE_AGENT_ID ?? process.env.IMP_AGENT_ID,
    "agentId",
  );

  if (!configPath) {
    throw new Error("imp-phone MCP server requires --config or IMP_CONFIG_PATH.");
  }
  if (!agentId) {
    throw new Error("imp-phone MCP server requires --agent-id, IMP_PHONE_AGENT_ID, or IMP_AGENT_ID.");
  }

  const resolvedConfigPath = resolve(configPath);
  const configDir = dirname(resolvedConfigPath);
  const appConfig = parseConfig(await readFile(resolvedConfigPath, "utf8"), resolvedConfigPath);
  const agent = findAgent(appConfig, agentId);
  const phone = readAgentPhoneConfig(agent, agentId);
  const requestsDir = resolveOptionalPath(
    optionalString(
      options.requestsDir
        ?? process.env.IMP_PHONE_REQUESTS_DIR
        ?? phone.requestsDir
        ?? findArgValue(Array.isArray(phone.args) ? phone.args : [], "--requests-dir"),
      "requestsDir",
    ),
    configDir,
  );

  if (!requestsDir) {
    throw new Error(
      `Agent "${agentId}" phone tools require IMP_PHONE_REQUESTS_DIR, phone.requestsDir, or phone.args with --requests-dir.`,
    );
  }

  const controlDir = resolveOptionalPath(
    optionalString(options.controlDir ?? process.env.IMP_PHONE_CONTROL_DIR ?? phone.controlDir, "controlDir"),
    configDir,
  ) ?? join(requestsDir, "control");

  return {
    agentId,
    configPath: resolvedConfigPath,
    contacts: normalizeContacts(phone.contacts, agentId),
    requestsDir,
    controlDir,
    timeoutMs: parseOptionalPositiveInteger(
      options.timeoutMs ?? process.env.IMP_PHONE_TOOL_TIMEOUT_MS ?? phone.timeoutMs,
      "timeoutMs",
    ),
    pollIntervalMs: parseOptionalPositiveInteger(
      options.pollIntervalMs ?? process.env.IMP_PHONE_TOOL_POLL_INTERVAL_MS,
      "pollIntervalMs",
    ),
  };
}

export async function executePhoneCallTool(config, params) {
  const { contactId, purpose } = parsePhoneCallParams(params);
  const contacts = new Map(config.contacts.map((contact) => [contact.id, contact]));
  const contact = contacts.get(contactId);
  if (!contact) {
    throw new Error(`Unknown phone contact: ${contactId}. Available contacts: ${[...contacts.keys()].join(", ")}`);
  }

  const result = await writeCallRequest({
    requestsDir: config.requestsDir,
    contactId: contact.id,
    contactName: contact.name,
    uri: contact.uri,
    ...(contact.comment ? { comment: contact.comment } : {}),
    agentId: config.agentId,
    ...(purpose ? { purpose } : {}),
    wait: true,
    ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
    ...(config.pollIntervalMs ? { pollIntervalMs: config.pollIntervalMs } : {}),
  });

  return {
    content: [
      {
        type: "text",
        text: renderPhoneCallResult(contact, result, purpose),
      },
    ],
    structuredContent: {
      contactId: contact.id,
      contactName: contact.name,
      ...(contact.comment ? { contactComment: contact.comment } : {}),
      requestsDir: config.requestsDir,
      callResult: result,
    },
  };
}

export async function executePhoneHangupTool(config, params) {
  const reason = parsePhoneHangupParams(params).reason ?? "agent-hangup";
  const id = `hangup-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const commandPath = join(
    config.controlDir,
    `${sanitizeFileName(id)}.json`,
  );

  await writeJsonAtomic(commandPath, {
    schemaVersion: 1,
    type: "hangup",
    id: basename(commandPath).replace(/\.json$/, ""),
    agentId: config.agentId,
    reason,
    requestedAt: new Date().toISOString(),
  });

  return {
    content: [
      {
        type: "text",
        text: `Phone hangup requested. Reason: ${reason}.`,
      },
    ],
    structuredContent: {
      controlDir: config.controlDir,
      commandPath,
      reason,
    },
  };
}

export function parseMcpServerArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      parsed.configPath = argv[++index];
    } else if (arg === "--agent-id") {
      parsed.agentId = argv[++index];
    } else if (arg === "--requests-dir") {
      parsed.requestsDir = argv[++index];
    } else if (arg === "--control-dir") {
      parsed.controlDir = argv[++index];
    } else if (arg === "--timeout-ms") {
      parsed.timeoutMs = parsePositiveInteger(argv[++index], "timeoutMs");
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function parseConfig(raw, configPath) {
  try {
    return JSON.parse(stripUtf8Bom(raw));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid config file ${configPath}\nMalformed JSON: ${message}`);
  }
}

function stripUtf8Bom(raw) {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function findAgent(config, agentId) {
  const agents = Array.isArray(config?.agents) ? config.agents : [];
  const agent = agents.find((entry) => entry?.id === agentId);
  if (!agent) {
    throw new Error(`Agent "${agentId}" is not configured.`);
  }
  return agent;
}

function readAgentPhoneConfig(agent, agentId) {
  const tools = agent.tools;
  if (!tools || Array.isArray(tools) || typeof tools !== "object" || !tools.phone) {
    throw new Error(`Agent "${agentId}" does not configure agents[].tools.phone.`);
  }
  return tools.phone;
}

function normalizeContacts(contacts, agentId) {
  if (!Array.isArray(contacts) || contacts.length === 0) {
    throw new Error(`Agent "${agentId}" phone config requires at least one contact.`);
  }

  const ids = new Set();
  return contacts.map((contact, index) => {
    if (typeof contact !== "object" || contact === null) {
      throw new Error(`Agent "${agentId}" phone contact ${index} must be an object.`);
    }

    const normalized = {
      id: requiredString(contact.id, `agents[].tools.phone.contacts[${index}].id`),
      name: requiredString(contact.name, `agents[].tools.phone.contacts[${index}].name`),
      uri: requiredString(contact.uri, `agents[].tools.phone.contacts[${index}].uri`),
      ...(contact.comment ? { comment: requiredString(contact.comment, `agents[].tools.phone.contacts[${index}].comment`) } : {}),
    };

    if (ids.has(normalized.id)) {
      throw new Error(`Duplicate phone contact id "${normalized.id}" for agent "${agentId}".`);
    }
    ids.add(normalized.id);
    return normalized;
  });
}

function parsePhoneCallParams(params) {
  if (typeof params !== "object" || params === null) {
    throw new Error("phone_call requires an object parameter with a contactId.");
  }

  const contactId = params.contactId;
  if (typeof contactId !== "string" || contactId.length === 0) {
    throw new Error("phone_call requires a non-empty string contactId.");
  }

  const purpose = params.purpose;
  if (purpose !== undefined && (typeof purpose !== "string" || purpose.length === 0)) {
    throw new Error("phone_call purpose must be a non-empty string when provided.");
  }

  return {
    contactId,
    ...(purpose ? { purpose } : {}),
  };
}

function parsePhoneHangupParams(params) {
  if (params === undefined || params === null) {
    return {};
  }
  if (typeof params !== "object") {
    throw new Error("phone_hangup requires an object parameter when provided.");
  }

  const reason = params.reason;
  if (reason !== undefined && (typeof reason !== "string" || reason.length === 0)) {
    throw new Error("phone_hangup reason must be a non-empty string when provided.");
  }

  return {
    ...(reason ? { reason } : {}),
  };
}

function renderPhoneCallResult(contact, result, purpose) {
  const statusText = (() => {
    switch (result.status) {
      case "answered":
        return `Phone call to ${contact.name} (${contact.id}) was answered.`;
      case "timeout":
        return `Phone call to ${contact.name} (${contact.id}) was not answered before the configured timeout.`;
      case "failed":
        return `Phone call to ${contact.name} (${contact.id}) failed.`;
      default:
        return `Phone call to ${contact.name} (${contact.id}) finished with status "${result.status}".`;
    }
  })();

  return [
    statusText,
    ...(result.reason ? [`Reason: ${result.reason}.`] : []),
    ...(result.conversationId ? [`Conversation id: ${result.conversationId}.`] : []),
    ...(result.requestId ? [`Request id: ${result.requestId}.`] : []),
    ...(purpose ? [`Purpose: ${purpose}`] : []),
  ].join("\n");
}

function resolveOptionalPath(value, configDir) {
  if (!value) {
    return undefined;
  }
  return isAbsolute(value) ? value : resolve(configDir, value);
}

function findArgValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
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

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function parseOptionalPositiveInteger(value, name) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return parsePositiveInteger(value, name);
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

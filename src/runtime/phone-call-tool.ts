import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentPhoneCallConfig, AgentPhoneContactConfig } from "../domain/agent.js";
import type { ToolDefinition } from "../tools/types.js";
import { createUserVisibleToolError, toUserVisibleToolError } from "./user-visible-tool-error.js";

const defaultPhoneCommand = "baresip";
const defaultPhoneArgs = ["-e", "/dial {uri}"];

export function createPhoneCallTools(
  config: AgentPhoneCallConfig | undefined,
  options: { agentId?: string } = {},
): ToolDefinition[] {
  if (!config) {
    return [];
  }

  return [createPhoneCallTool(config, options), createPhoneHangupTool(config, options)];
}

function createPhoneCallTool(config: AgentPhoneCallConfig, options: { agentId?: string }): ToolDefinition {
  const contacts = new Map(config.contacts.map((contact) => [contact.id, contact]));
  const parameters = {
    type: "object",
    properties: {
      contactId: {
        type: "string",
        enum: config.contacts.map((contact) => contact.id),
        minLength: 1,
        description: "Exact id of the allowed phone contact to call.",
      },
      purpose: {
        type: "string",
        minLength: 1,
        description:
          "Detailed prompt for the AI agent that will conduct the phone call. Include the reason for the call, relevant context, desired outcome, and important constraints.",
      },
    },
    required: ["contactId"],
    additionalProperties: false,
  } as unknown as ToolDefinition["parameters"];

  const contactList = config.contacts.map(formatContactForDescription).join(", ");

  return {
    name: "phone_call",
    label: "phone_call",
    description:
      `Start an allowlisted SIP phone call through the configured local phone command. ` +
      `Allowed contacts: ${contactList}.`,
    parameters,
    async execute(_toolCallId, params, signal) {
      const { contactId, purpose } = parsePhoneCallParams(params);
      const contact = contacts.get(contactId);
      if (!contact) {
        throw createUserVisibleToolError(
          "tool_command_execution",
          `Unknown phone contact: ${contactId}. Available contacts: ${[...contacts.keys()].join(", ")}`,
        );
      }

      const result = await runPhoneCommand(config, contact, signal, options.agentId, purpose).catch((error: unknown) => {
        throw toUserVisibleToolError(error, {
          fallbackMessage: "Configured phone command could not be started.",
          defaultKind: "tool_command_execution",
          classifyFileErrors: false,
        });
      });
      return {
        content: [
          {
            type: "text",
            text: renderPhoneCallResult(contact, result, purpose),
          },
        ],
        details: {
          contactId: contact.id,
          contactName: contact.name,
          ...(contact.comment ? { contactComment: contact.comment } : {}),
          command: result.command,
          args: result.args,
          exitCode: result.exitCode,
          signal: result.signal,
          stdout: result.stdout,
          stderr: result.stderr,
          ...(result.callResult ? { callResult: result.callResult } : {}),
        },
        ...(result.exitCode === 0 ? {} : { isError: true }),
      };
    },
  };
}

function createPhoneHangupTool(config: AgentPhoneCallConfig, options: { agentId?: string }): ToolDefinition {
  const parameters = {
    type: "object",
    properties: {
      reason: {
        type: "string",
        minLength: 1,
        description: "Optional short reason for ending the current phone call.",
      },
    },
    additionalProperties: false,
  } as unknown as ToolDefinition["parameters"];

  return {
    name: "phone_hangup",
    label: "phone_hangup",
    description:
      "End the currently active imp-phone call. Use this after a brief goodbye when the phone conversation is done.",
    parameters,
    async execute(_toolCallId, params) {
      const reason = parsePhoneHangupParams(params).reason ?? "agent-hangup";
      const controlDir = resolvePhoneControlDir(config);
      if (!controlDir) {
        throw createUserVisibleToolError(
          "tool_command_execution",
          "phone_hangup requires agents[].tools.phone.controlDir or request-call args with --requests-dir.",
        );
      }

      const commandPath = await writePhoneControlCommand(controlDir, {
        schemaVersion: 1,
        type: "hangup",
        id: `hangup-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`,
        ...(options.agentId ? { agentId: options.agentId } : {}),
        reason,
        requestedAt: new Date().toISOString(),
      }).catch((error: unknown) => {
        throw toUserVisibleToolError(error, {
          fallbackMessage: "Phone hangup request could not be written.",
          defaultKind: "file_document_persistence",
        });
      });

      return {
        content: [
          {
            type: "text",
            text: `Phone hangup requested. Reason: ${reason}.`,
          },
        ],
        details: {
          controlDir,
          commandPath,
          reason,
        },
      };
    },
  };
}

interface PhoneCallParams {
  contactId: string;
  purpose?: string;
}

interface PhoneHangupParams {
  reason?: string;
}

interface PhoneCommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  callResult?: PhoneCallResult;
}

function parsePhoneHangupParams(params: unknown): PhoneHangupParams {
  if (params === undefined || params === null) {
    return {};
  }
  if (typeof params !== "object") {
    throw createUserVisibleToolError("tool_command_execution", "phone_hangup requires an object parameter when provided.");
  }

  const reason = "reason" in params ? params.reason : undefined;
  if (reason !== undefined && (typeof reason !== "string" || reason.length === 0)) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      "phone_hangup reason must be a non-empty string when provided.",
    );
  }

  return {
    ...(reason ? { reason } : {}),
  };
}

async function writePhoneControlCommand(controlDir: string, payload: Record<string, unknown>): Promise<string> {
  await mkdir(controlDir, { recursive: true });
  const path = join(controlDir, `${sanitizeFileName(String(payload.id))}.json`);
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
  return path;
}

function resolvePhoneControlDir(config: AgentPhoneCallConfig): string | undefined {
  if (config.controlDir) {
    return config.controlDir;
  }
  const requestDir = findArgValue(config.args ?? [], "--requests-dir");
  return requestDir ? join(requestDir, "control") : undefined;
}

function findArgValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

interface PhoneCallResult {
  status: string;
  requestId?: string;
  conversationId?: string;
  reason?: string;
}

function parsePhoneCallParams(params: unknown): PhoneCallParams {
  if (typeof params !== "object" || params === null) {
    throw createUserVisibleToolError("tool_command_execution", "phone_call requires an object parameter with a contactId.");
  }

  const contactId = "contactId" in params ? params.contactId : undefined;
  if (typeof contactId !== "string" || contactId.length === 0) {
    throw createUserVisibleToolError("tool_command_execution", "phone_call requires a non-empty string contactId.");
  }

  const purpose = "purpose" in params ? params.purpose : undefined;
  if (purpose !== undefined && (typeof purpose !== "string" || purpose.length === 0)) {
    throw createUserVisibleToolError(
      "tool_command_execution",
      "phone_call purpose must be a non-empty string when provided.",
    );
  }

  return {
    contactId,
    ...(purpose ? { purpose } : {}),
  };
}

function runPhoneCommand(
  config: AgentPhoneCallConfig,
  contact: AgentPhoneContactConfig,
  signal: AbortSignal | undefined,
  agentId: string | undefined,
  purpose: string | undefined,
): Promise<PhoneCommandResult> {
  const command = renderTemplate(config.command ?? defaultPhoneCommand, contact, purpose);
  const args = (config.args ?? defaultPhoneArgs).map((arg) => renderTemplate(arg, contact, purpose));

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: config.cwd,
      env: {
        ...process.env,
        ...(config.env ?? {}),
        ...(agentId ? { IMP_PHONE_AGENT_ID: agentId } : {}),
        ...(contact.comment ? { IMP_PHONE_CONTACT_COMMENT: contact.comment } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      signal?.removeEventListener("abort", abort);
    };

    const abort = () => {
      child.kill("SIGTERM");
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("close", (exitCode, closeSignal) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        command,
        args,
        exitCode,
        signal: closeSignal,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        callResult: parsePhoneCallResult(stdout),
      });
    });

    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
    }

    if (config.timeoutMs) {
      timeout = setTimeout(() => {
        child.kill("SIGTERM");
      }, config.timeoutMs);
      timeout.unref();
    }
  });
}

function renderTemplate(template: string, contact: AgentPhoneContactConfig, purpose?: string): string {
  return template
    .replaceAll("{contactId}", contact.id)
    .replaceAll("{contactName}", contact.name)
    .replaceAll("{comment}", contact.comment ?? "")
    .replaceAll("{purpose}", purpose ?? "")
    .replaceAll("{uri}", contact.uri);
}

function formatContactForDescription(contact: AgentPhoneContactConfig): string {
  return `${contact.id} (${contact.name}${contact.comment ? `, ${contact.comment}` : ""})`;
}

function renderPhoneCallResult(
  contact: AgentPhoneContactConfig,
  result: PhoneCommandResult,
  purpose: string | undefined,
): string {
  if (result.callResult) {
    return renderPhoneCallStatusResult(contact, result.callResult, purpose, result);
  }

  const status = result.exitCode === 0 ? "completed successfully" : "failed";
  return [
    `Phone call command for ${contact.name} (${contact.id}) ${status}.`,
    "This confirms only that the configured phone command finished; it does not confirm ringing, connection, or call audio.",
    ...(purpose ? [`Purpose: ${purpose}`] : []),
    `Exit code: ${result.exitCode ?? "none"}.`,
    ...(result.signal ? [`Signal: ${result.signal}.`] : []),
    ...(result.stderr ? [`stderr:\n${result.stderr}`] : []),
    ...(result.stdout ? [`stdout:\n${result.stdout}`] : []),
  ].join("\n");
}

function renderPhoneCallStatusResult(
  contact: AgentPhoneContactConfig,
  callResult: PhoneCallResult,
  purpose: string | undefined,
  commandResult: PhoneCommandResult,
): string {
  const statusText = (() => {
    switch (callResult.status) {
      case "answered":
        return `Phone call to ${contact.name} (${contact.id}) was answered.`;
      case "timeout":
        return `Phone call to ${contact.name} (${contact.id}) was not answered before the configured timeout.`;
      case "failed":
        return `Phone call to ${contact.name} (${contact.id}) failed.`;
      default:
        return `Phone call to ${contact.name} (${contact.id}) finished with status "${callResult.status}".`;
    }
  })();

  return [
    statusText,
    ...(callResult.reason ? [`Reason: ${callResult.reason}.`] : []),
    ...(callResult.conversationId ? [`Conversation id: ${callResult.conversationId}.`] : []),
    ...(callResult.requestId ? [`Request id: ${callResult.requestId}.`] : []),
    ...(purpose ? [`Purpose: ${purpose}`] : []),
    `Exit code: ${commandResult.exitCode ?? "none"}.`,
    ...(commandResult.signal ? [`Signal: ${commandResult.signal}.`] : []),
    ...(commandResult.stderr ? [`stderr:\n${commandResult.stderr}`] : []),
  ].join("\n");
}

function parsePhoneCallResult(stdout: string): PhoneCallResult | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || !("status" in parsed)) {
      return undefined;
    }
    const status = parsed.status;
    if (typeof status !== "string" || status.length === 0) {
      return undefined;
    }

    return {
      status,
      ...readOptionalString(parsed, "requestId"),
      ...readOptionalString(parsed, "conversationId"),
      ...readOptionalString(parsed, "reason"),
    };
  } catch {
    return undefined;
  }
}

function readOptionalString(value: object, key: keyof PhoneCallResult): Partial<PhoneCallResult> {
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "string" && entry.length > 0 ? { [key]: entry } : {};
}

import { spawn } from "node:child_process";
import type { AgentPhoneCallConfig, AgentPhoneContactConfig } from "../domain/agent.js";
import type { ToolDefinition } from "../tools/types.js";

const defaultPhoneCommand = "baresip";
const defaultPhoneArgs = ["-e", "/dial {uri}"];

export function createPhoneCallTools(
  config: AgentPhoneCallConfig | undefined,
  options: { agentId?: string } = {},
): ToolDefinition[] {
  if (!config) {
    return [];
  }

  return [createPhoneCallTool(config, options)];
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
        throw new Error(`Unknown phone contact: ${contactId}. Available contacts: ${[...contacts.keys()].join(", ")}`);
      }

      const result = await runPhoneCommand(config, contact, signal, options.agentId, purpose);
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
        },
        ...(result.exitCode === 0 ? {} : { isError: true }),
      };
    },
  };
}

interface PhoneCallParams {
  contactId: string;
  purpose?: string;
}

interface PhoneCommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function parsePhoneCallParams(params: unknown): PhoneCallParams {
  if (typeof params !== "object" || params === null) {
    throw new Error("phone_call requires an object parameter with a contactId.");
  }

  const contactId = "contactId" in params ? params.contactId : undefined;
  if (typeof contactId !== "string" || contactId.length === 0) {
    throw new Error("phone_call requires a non-empty string contactId.");
  }

  const purpose = "purpose" in params ? params.purpose : undefined;
  if (purpose !== undefined && (typeof purpose !== "string" || purpose.length === 0)) {
    throw new Error("phone_call purpose must be a non-empty string when provided.");
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

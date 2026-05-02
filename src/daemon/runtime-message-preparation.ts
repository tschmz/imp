import { parseInboundCommand } from "../application/commands/parse-inbound-command.js";
import { priorityInboundCommands } from "../application/commands/priority-inbound-commands.js";
import type { AgentRegistry } from "../agents/registry.js";
import type { ChatRef, ConversationContext } from "../domain/conversation.js";
import type { IncomingMessage } from "../domain/message.js";
import type { TransportInboundEvent } from "../transports/types.js";
import type { BootstrappedRuntime } from "./runtime-bootstrap.js";

export function createRuntimeMessagePreparer(
  runtime: BootstrappedRuntime,
  agentRegistry: AgentRegistry,
): (event: TransportInboundEvent) => Promise<TransportInboundEvent> {
  return async (event) => {
    const scopedEvent = withEndpointScopedConversation(event);
    const command = scopedEvent.message.command
      ? {
          command: scopedEvent.message.command,
          ...(scopedEvent.message.commandArgs ? { commandArgs: scopedEvent.message.commandArgs } : {}),
        }
      : parseInboundCommand(scopedEvent.message.text);
    const commandEvent = command
      ? {
          ...scopedEvent,
          message: {
            ...scopedEvent.message,
            ...command,
          },
        }
      : scopedEvent;

    if (command && priorityInboundCommands.has(command.command)) {
      return commandEvent;
    }

    const selectedAgentId =
      await runtime.conversationStore.getSelectedAgent?.(commandEvent.message.conversation) ??
      runtime.endpointConfig.defaultAgentId;
    const detachedSession = getDetachedSessionRequest(commandEvent.message);
    const resolvedAgentId = resolveDetachedAgentId(detachedSession, agentRegistry) ?? selectedAgentId;
    const conversation = detachedSession && commandEvent.message.conversation.sessionId
      ? await ensureDetachedConversation(runtime, commandEvent.message, resolvedAgentId, detachedSession)
      : await ensureActiveConversation(runtime, commandEvent.message, resolvedAgentId);

    return {
      ...commandEvent,
      message: {
        ...commandEvent.message,
        conversation: {
          ...commandEvent.message.conversation,
          sessionId: conversation.state.conversation.sessionId,
          agentId: resolvedAgentId,
        },
      },
    };
  };
}

async function ensureActiveConversation(
  runtime: BootstrappedRuntime,
  message: IncomingMessage,
  selectedAgentId: string,
): Promise<ConversationContext> {
  const ensureActive =
    runtime.conversationStore.ensureActiveForAgent ?? runtime.conversationStore.ensureActive;
  return await ensureActive(
    message.conversation,
    {
      agentId: selectedAgentId,
      now: message.receivedAt,
    },
  );
}

async function ensureDetachedConversation(
  runtime: BootstrappedRuntime,
  message: IncomingMessage,
  selectedAgentId: string,
  detachedSession: DetachedSessionRequest,
): Promise<ConversationContext> {
  if (!runtime.conversationStore.ensureDetachedForAgent) {
    return await ensureActiveConversation(runtime, message, selectedAgentId);
  }

  return await runtime.conversationStore.ensureDetachedForAgent(message.conversation, {
    agentId: selectedAgentId,
    now: message.receivedAt,
    title: detachedSession.title,
    kind: detachedSession.kind,
    metadata: detachedSession.metadata,
  });
}

interface DetachedSessionRequest {
  mode: "detached";
  id: string;
  agentId?: string;
  kind?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

function getDetachedSessionRequest(message: IncomingMessage): DetachedSessionRequest | undefined {
  const session = message.source?.plugin?.metadata?.session;
  if (typeof session !== "object" || session === null) {
    return undefined;
  }
  const candidate = session as Record<string, unknown>;
  if (candidate.mode !== "detached" || typeof candidate.id !== "string" || candidate.id.length === 0) {
    return undefined;
  }
  return {
    mode: "detached",
    id: candidate.id,
    ...(typeof candidate.agentId === "string" ? { agentId: candidate.agentId } : {}),
    ...(typeof candidate.kind === "string" ? { kind: candidate.kind } : {}),
    ...(typeof candidate.title === "string" ? { title: candidate.title } : {}),
    ...(isRecord(candidate.metadata) ? { metadata: candidate.metadata } : {}),
  };
}

function resolveDetachedAgentId(
  detachedSession: DetachedSessionRequest | undefined,
  agentRegistry: AgentRegistry,
): string | undefined {
  if (!detachedSession?.agentId) {
    return undefined;
  }
  return agentRegistry.get(detachedSession.agentId) ? detachedSession.agentId : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withEndpointScopedConversation<TEvent extends { message: { endpointId: string; conversation: ChatRef } }>(
  event: TEvent,
): TEvent {
  return {
    ...event,
    message: {
      ...event.message,
      conversation: {
        ...event.message.conversation,
        endpointId: event.message.endpointId,
      },
    },
  };
}

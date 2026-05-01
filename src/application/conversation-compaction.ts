import type { Api as AiApi, Model } from "@mariozechner/pi-ai";
import type { AgentDefinition } from "../domain/agent.js";
import type {
  ConversationCompactionState,
  ConversationContext,
} from "../domain/conversation.js";
import {
  DEFAULT_COMPACTION_KEEP_RECENT_TOKENS,
  planConversationCompaction,
  serializeConversationEventsForSummary,
  type ConversationCompactionPlan,
} from "../domain/conversation-compaction.js";
import type { IncomingMessage } from "../domain/message.js";
import type { AgentEngine } from "../runtime/types.js";
import type { RuntimeCommandInfo } from "./commands/types.js";
import type { ConversationStore } from "../storage/types.js";

export interface CompactConversationOptions {
  conversation: ConversationContext;
  agent: AgentDefinition;
  message: IncomingMessage;
  engine: AgentEngine;
  conversationStore: ConversationStore;
  runtimeInfo: RuntimeCommandInfo;
  model?: Model<AiApi>;
  customInstructions?: string;
  force?: boolean;
  keepRecentTokens?: number;
}

export interface CompactConversationResult {
  conversation: ConversationContext;
  compaction: ConversationCompactionState;
  plan: ConversationCompactionPlan;
}

const COMPACTION_SYSTEM_PROMPT = [
  "You are a context compaction assistant.",
  "Read the supplied conversation transcript and produce a concise checkpoint summary for another assistant continuing the same session.",
  "Do not answer user requests from the transcript.",
  "Preserve exact file paths, commands, function names, decisions, constraints, open tasks, errors, and user preferences.",
  "If a previous summary is supplied, update it with the new transcript instead of replacing useful existing context.",
].join("\n");

export async function compactConversation(
  options: CompactConversationOptions,
): Promise<CompactConversationResult | undefined> {
  const plan = planConversationCompaction(options.conversation, {
    force: options.force === true,
    keepRecentTokens: options.keepRecentTokens ?? DEFAULT_COMPACTION_KEEP_RECENT_TOKENS,
  });
  if (!plan) {
    return undefined;
  }

  const summary = await generateCompactionSummary({
    ...options,
    plan,
    previousSummary: options.conversation.state.compaction?.summary,
  });
  const now = options.message.receivedAt;
  const previousSequence = options.conversation.state.compaction?.sequence ?? 0;
  const compaction: ConversationCompactionState = {
    summary,
    firstKeptMessageId: plan.firstKeptMessageId,
    compactedThroughMessageId: plan.compactedThroughMessageId,
    createdAt: now,
    messageCountBefore: options.conversation.messages.length,
    messageCountSummarized: plan.messagesToSummarize.length,
    messageCountKept: plan.recentMessages.length,
    sequence: previousSequence + 1,
    tokensBefore: plan.tokensBefore,
    tokensAfter: plan.tokensAfter + Math.ceil(summary.length / 4),
    ...(options.model
      ? {
          model: {
            provider: options.model.provider,
            model: options.model.id,
            api: options.model.api,
          },
        }
      : {}),
  };

  const updatedConversation = await writeCompactionState(
    options.conversationStore,
    options.conversation,
    {
      updatedAt: now,
      compaction,
    },
  );

  return {
    conversation: updatedConversation,
    compaction,
    plan,
  };
}

async function generateCompactionSummary(
  options: CompactConversationOptions & {
    plan: ConversationCompactionPlan;
    previousSummary?: string;
  },
): Promise<string> {
  const prompt = renderCompactionPrompt({
    conversationText: serializeConversationEventsForSummary(options.plan.messagesToSummarize),
    previousSummary: options.previousSummary,
    customInstructions: options.customInstructions,
  });
  const compactorAgent = createCompactorAgent(options.agent);
  const result = await options.engine.run({
    agent: compactorAgent,
    conversation: createDetachedCompactionConversation(options.conversation, compactorAgent, options.message),
    message: createCompactionPromptMessage(options.message, prompt),
    runtime: {
      configPath: options.runtimeInfo.configPath,
      dataRoot: options.runtimeInfo.dataRoot,
      invocation: {
        kind: "direct",
      },
      ingress: {
        endpointId: options.message.endpointId,
        transportKind: options.message.conversation.transport,
      },
      output: {
        mode: "reply-channel",
        replyChannel: {
          kind: "none",
          delivery: "none",
        },
      },
      replyChannel: {
        kind: "none",
        delivery: "none",
      },
    },
  });

  const summary = result.message.text.trim();
  if (!summary) {
    throw new Error("Compaction failed: summarizer produced an empty summary.");
  }

  return summary;
}

function renderCompactionPrompt(options: {
  conversationText: string;
  previousSummary?: string;
  customInstructions?: string;
}): string {
  return [
    "<conversation>",
    options.conversationText,
    "</conversation>",
    "",
    ...(options.previousSummary?.trim()
      ? [
          "<previous_summary>",
          options.previousSummary.trim(),
          "</previous_summary>",
          "",
        ]
      : []),
    ...(options.customInstructions?.trim()
      ? [
          "<additional_focus>",
          options.customInstructions.trim(),
          "</additional_focus>",
          "",
        ]
      : []),
    "Create a compact context checkpoint with these sections:",
    "",
    "## Goal",
    "## Constraints & Preferences",
    "## Progress",
    "## Key Decisions",
    "## Important Details",
    "## Next Steps",
    "",
    "Keep it concise, but do not omit information needed to continue the session correctly.",
  ].join("\n");
}

function createCompactorAgent(agent: AgentDefinition): AgentDefinition {
  return {
    id: `${agent.id}-compactor`,
    name: `${agent.name} Compactor`,
    prompt: {
      base: {
        text: COMPACTION_SYSTEM_PROMPT,
      },
    },
    model: agent.model,
    ...(agent.home ? { home: agent.home } : {}),
    ...(agent.workspace ? { workspace: agent.workspace } : {}),
    tools: [],
    extensions: [],
  };
}

function createDetachedCompactionConversation(
  conversation: ConversationContext,
  agent: AgentDefinition,
  message: IncomingMessage,
): ConversationContext {
  return {
    state: {
      conversation: {
        transport: conversation.state.conversation.transport,
        externalId: conversation.state.conversation.externalId,
        sessionId: `${conversation.state.conversation.sessionId ?? "active"}-compact-${message.messageId}`,
      },
      agentId: agent.id,
      createdAt: message.receivedAt,
      updatedAt: message.receivedAt,
      version: 1,
    },
    messages: [],
  };
}

function createCompactionPromptMessage(
  message: IncomingMessage,
  prompt: string,
): IncomingMessage {
  return {
    endpointId: message.endpointId,
    conversation: message.conversation,
    messageId: `${message.messageId}:compact`,
    correlationId: `${message.correlationId}:compact`,
    userId: message.userId,
    text: prompt,
    receivedAt: message.receivedAt,
    source: {
      kind: "text",
    },
  };
}

async function writeCompactionState(
  store: ConversationStore,
  conversation: ConversationContext,
  patch: Pick<ConversationContext["state"], "updatedAt" | "compaction">,
): Promise<ConversationContext> {
  if (store.updateState) {
    return store.updateState(conversation, patch);
  }

  const next = {
    ...conversation,
    state: {
      ...conversation.state,
      ...patch,
    },
  };
  await store.put(next);
  return next;
}

import type { AgentOptions } from "@mariozechner/pi-agent-core";
import type { AgentDefinition } from "../../domain/agent.js";
import type { AgentHandle } from "../agent-execution.js";
import { executeAgent } from "../agent-execution.js";
import type { AgentRunResult } from "../context.js";
import { renderIncomingMessageTextForAgent } from "../message-mapping.js";
import { createOnPayloadOverride } from "./resolve-tools-stage.js";
import type { ResolveToolsStageContext } from "./resolve-tools-stage.js";

export interface ExecuteAgentStageContext extends ResolveToolsStageContext {
  result: AgentRunResult;
}

export async function executeAgentStage(
  context: ResolveToolsStageContext,
  dependencies: {
    createAgent?: (options: AgentOptions) => AgentHandle;
    getApiKey?: (
      provider: string,
      agent: AgentDefinition,
    ) => Promise<string | undefined> | string | undefined;
  },
): Promise<ExecuteAgentStageContext> {
  const result = await executeAgent({
    createAgent: dependencies.createAgent,
    getApiKey: dependencies.getApiKey,
    agent: context.agent,
    model: context.model,
    systemPrompt: context.systemPromptResolution.systemPrompt,
    tools: context.tools,
    userText: renderIncomingMessageTextForAgent(context.input.message),
    conversationMessages: context.conversation.messages,
    onPayload: createOnPayloadOverride(context.agent),
    workingDirectoryState: context.workingDirectoryState,
    initialWorkingDirectory: context.initialWorkingDirectory,
    conversation: context.input.message.conversation,
    parentMessageId: context.input.message.messageId,
    correlationId: context.input.message.correlationId,
    onConversationEvents: context.input.onConversationEvents,
    continueFromContext: context.input.continueFromContext,
  });

  return {
    ...context,
    result,
  };
}

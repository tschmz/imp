import type { AgentDefinition } from "../../domain/agent.js";
import type { ConversationContext } from "../../domain/conversation.js";
import type { IncomingMessage, OutgoingMessage } from "../../domain/message.js";
import type { HookRunner } from "../../extensions/hook-runner.js";
import type { InboundMessageLifecycleHooks } from "../../extensions/types.js";
import type { SkillDefinition } from "../../skills/types.js";
import type { HandleIncomingMessageDependencies, InboundCommandHandler } from "../commands/types.js";
import type { MidRunMessageSource } from "../../runtime/context.js";

export interface InboundProcessingContext {
  readonly message: IncomingMessage;
  readonly dependencies: HandleIncomingMessageDependencies;
  readonly defaultAgent: AgentDefinition;
  readonly availableCommands: ReadonlyArray<InboundCommandHandler>;
  readonly loadAppConfig: NonNullable<HandleIncomingMessageDependencies["loadAppConfig"]>;
  readonly readRecentLogLines: NonNullable<HandleIncomingMessageDependencies["readRecentLogLines"]>;
  readonly hookRunner: HookRunner<InboundMessageLifecycleHooks>;
  readonly startedAt: number;
  readonly deliverProgress?: (message: OutgoingMessage) => Promise<void> | void;
  readonly midRunMessages?: MidRunMessageSource;
  readonly availableSkills: ReadonlyArray<SkillDefinition>;
}

export interface InboundHandledContext extends InboundProcessingContext {
  readonly response: OutgoingMessage;
}

export interface ResolvedInboundProcessingContext extends InboundProcessingContext {
  readonly conversation: ConversationContext;
  readonly agent: AgentDefinition;
}

export interface ResolvedHandledInboundProcessingContext
  extends ResolvedInboundProcessingContext, InboundHandledContext {}

export function createInboundProcessingContext(input: {
  message: IncomingMessage;
  dependencies: HandleIncomingMessageDependencies;
  defaultAgent: AgentDefinition;
  availableCommands: ReadonlyArray<InboundCommandHandler>;
  loadAppConfig: NonNullable<HandleIncomingMessageDependencies["loadAppConfig"]>;
  readRecentLogLines: NonNullable<HandleIncomingMessageDependencies["readRecentLogLines"]>;
  hookRunner: HookRunner<InboundMessageLifecycleHooks>;
  startedAt: number;
  deliverProgress?: (message: OutgoingMessage) => Promise<void> | void;
  midRunMessages?: MidRunMessageSource;
}): InboundProcessingContext {
  return {
    ...input,
    availableSkills: [],
  };
}

export function withInboundMessage<TContext extends InboundProcessingContext>(
  context: TContext,
  message: IncomingMessage,
): TContext {
  return {
    ...context,
    message,
  };
}

export function withResolvedConversation<TContext extends InboundProcessingContext>(
  context: TContext,
  input: {
    conversation: ConversationContext;
    agent: AgentDefinition;
  },
): TContext & ResolvedInboundProcessingContext {
  return {
    ...context,
    ...input,
  };
}

export function withAvailableSkills<TContext extends ResolvedInboundProcessingContext>(
  context: TContext,
  availableSkills: ReadonlyArray<SkillDefinition>,
): TContext {
  return {
    ...context,
    availableSkills,
  };
}

export function withConversation<TContext extends ResolvedInboundProcessingContext>(
  context: TContext,
  conversation: ConversationContext,
): TContext {
  return {
    ...context,
    conversation,
  };
}

export function withResponse<TContext extends InboundProcessingContext>(
  context: TContext,
  response: OutgoingMessage,
): TContext & InboundHandledContext {
  return {
    ...context,
    response,
  };
}

export function hasResponse(
  context: InboundProcessingContext | InboundHandledContext,
): context is InboundHandledContext {
  return "response" in context;
}

import type { InboundCommandHandler } from "../application/commands/types.js";
import type { AgentRunInput, AgentRunResult } from "../runtime/context.js";
import type { ToolDefinition } from "../tools/types.js";
import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";

export type MaybePromise<T> = T | Promise<T>;

export interface InboundMessageStartContext {
  message: IncomingMessage;
}

export interface InboundMessageSuccessContext {
  message: IncomingMessage;
  response: OutgoingMessage;
  durationMs: number;
}

export interface InboundMessageErrorContext {
  message: IncomingMessage;
  error: unknown;
  durationMs: number;
}

export interface InboundMessageLifecycleHooks {
  onInboundMessageStart?(context: InboundMessageStartContext): MaybePromise<void>;
  onInboundMessageSuccess?(context: InboundMessageSuccessContext): MaybePromise<void>;
  onInboundMessageError?(context: InboundMessageErrorContext): MaybePromise<void>;
}

export interface AgentEngineRunStartContext {
  input: AgentRunInput;
}

export interface AgentEngineRunSuccessContext {
  input: AgentRunInput;
  result: AgentRunResult;
  durationMs: number;
}

export interface AgentEngineRunErrorContext {
  input: AgentRunInput;
  error: unknown;
  durationMs: number;
}

export interface AgentEngineLifecycleHooks {
  onAgentEngineRunStart?(context: AgentEngineRunStartContext): MaybePromise<void>;
  onAgentEngineRunSuccess?(context: AgentEngineRunSuccessContext): MaybePromise<void>;
  onAgentEngineRunError?(context: AgentEngineRunErrorContext): MaybePromise<void>;
}

export interface CommandContribution {
  inboundCommands: ReadonlyArray<InboundCommandHandler>;
}

export interface ToolContribution {
  tools: ReadonlyArray<ToolDefinition>;
}

export interface PluginHooks {
  inboundMessage?: InboundMessageLifecycleHooks;
  agentEngine?: AgentEngineLifecycleHooks;
}

export interface PluginContributions {
  commands?: CommandContribution;
  tools?: ToolContribution;
}

export interface ImpPlugin {
  id: string;
  hooks?: PluginHooks;
  contributions?: PluginContributions;
}

export interface HookRegistration<THooks> {
  name: string;
  hooks: THooks;
}

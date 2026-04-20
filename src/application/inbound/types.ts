import type { AgentDefinition } from "../../domain/agent.js";
import type { ConversationContext } from "../../domain/conversation.js";
import type { IncomingMessage, OutgoingMessage } from "../../domain/message.js";
import type { HookRunner } from "../../extensions/hook-runner.js";
import type { InboundMessageLifecycleHooks } from "../../extensions/types.js";
import type { SkillDefinition } from "../../skills/types.js";
import type { HandleIncomingMessageDependencies, InboundCommandHandler } from "../commands/types.js";

export interface InboundProcessingContext {
  message: IncomingMessage;
  dependencies: HandleIncomingMessageDependencies;
  defaultAgent: AgentDefinition;
  availableCommands: ReadonlyArray<InboundCommandHandler>;
  loadAppConfig: NonNullable<HandleIncomingMessageDependencies["loadAppConfig"]>;
  readRecentLogLines: NonNullable<HandleIncomingMessageDependencies["readRecentLogLines"]>;
  hookRunner: HookRunner<InboundMessageLifecycleHooks>;
  startedAt: number;
  response?: OutgoingMessage;
  conversation?: ConversationContext;
  agent?: AgentDefinition;
  availableSkills: SkillDefinition[];
}

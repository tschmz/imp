import type { AgentDefinition } from "../../domain/agent.js";
import type { ConversationContext } from "../../domain/conversation.js";
import {
  createPromptTemplateContext,
  type PromptTemplateContext,
  type PromptTemplateSystemContext,
} from "../prompt-template.js";
import { resolveSystemPrompt } from "../system-prompt-resolution.js";
import type { SystemPromptCache } from "../system-prompt-cache.js";
import type { ResolveModelStageContext } from "./resolve-model-stage.js";

export interface ResolvePromptStageContext extends ResolveModelStageContext {
  systemPromptResolution: Awaited<ReturnType<typeof resolveSystemPrompt>>;
  templateContext: PromptTemplateContext;
}

export async function resolvePromptStage(
  context: ResolveModelStageContext,
  dependencies: {
    readTextFile: (path: string) => Promise<string>;
    systemPromptCache: SystemPromptCache;
    promptTemplateSystemContext: PromptTemplateSystemContext;
  },
): Promise<ResolvePromptStageContext> {
  const promptWorkingDirectory = resolvePromptWorkingDirectory(context.agent, context.conversation);
  const templateContext = createPromptTemplateContext({
    system: dependencies.promptTemplateSystemContext,
    agent: context.agent,
    conversation: context.conversation,
    endpointId: context.input.message.endpointId,
    transportKind: context.input.message.conversation.transport,
    replyChannel: context.input.runtime?.replyChannel,
    configPath: context.input.runtime?.configPath,
    dataRoot: context.input.runtime?.dataRoot,
    availableSkills: context.input.runtime?.availableSkills,
  });
  const systemPromptResolution = await resolveSystemPrompt({
    agent: context.agent,
    promptWorkingDirectory,
    templateContext,
    availableSkills: context.input.runtime?.availableSkills,
    readTextFile: dependencies.readTextFile,
    cache: dependencies.systemPromptCache,
  });

  return {
    ...context,
    promptWorkingDirectory,
    systemPromptResolution,
    templateContext,
  };
}

function resolvePromptWorkingDirectory(
  agent: AgentDefinition,
  conversation: ConversationContext,
): string | undefined {
  return conversation.state.workingDirectory ?? agent.workspace?.cwd;
}

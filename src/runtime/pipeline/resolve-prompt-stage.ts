import type { AgentDefinition } from "../../domain/agent.js";
import type { ConversationContext } from "../../domain/conversation.js";
import { createPromptTemplateContext, type PromptTemplateSystemContext } from "../prompt-template.js";
import { resolveSystemPrompt } from "../system-prompt-resolution.js";
import type { SystemPromptCache } from "../system-prompt-cache.js";
import type { ResolveModelStageContext } from "./resolve-model-stage.js";

export interface ResolvePromptStageContext extends ResolveModelStageContext {
  systemPromptResolution: Awaited<ReturnType<typeof resolveSystemPrompt>>;
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
  const systemPromptResolution = await resolveSystemPrompt({
    agent: context.agent,
    promptWorkingDirectory,
    templateContext: createPromptTemplateContext({
      system: dependencies.promptTemplateSystemContext,
      agent: context.agent,
      botId: context.input.message.botId,
      transportKind: context.input.message.conversation.transport,
      configPath: context.input.runtime?.configPath,
      dataRoot: context.input.runtime?.dataRoot,
      availableSkills: context.input.runtime?.availableSkills,
    }),
    availableSkills: context.input.runtime?.availableSkills,
    readTextFile: dependencies.readTextFile,
    cache: dependencies.systemPromptCache,
  });

  return {
    ...context,
    promptWorkingDirectory,
    systemPromptResolution,
  };
}

function resolvePromptWorkingDirectory(
  agent: AgentDefinition,
  conversation: ConversationContext,
): string | undefined {
  return conversation.state.workingDirectory ?? agent.workspace?.cwd;
}

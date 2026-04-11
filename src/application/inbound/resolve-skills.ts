import type { InboundProcessingContext } from "./types.js";

export async function resolveSkills(context: InboundProcessingContext): Promise<void> {
  if (context.response || !context.agent) {
    return;
  }

  const skillCatalog = context.dependencies.skillCatalog ?? [];
  const skillSelector = context.dependencies.skillSelector;
  if (skillCatalog.length === 0 || !skillSelector) {
    context.activatedSkills = [];
    return;
  }

  try {
    const activatedSkills = await skillSelector.selectRelevantSkills({
      agent: context.agent,
      userText: context.message.text,
      catalog: skillCatalog,
      maxActivatedSkills: 3,
    });

    const logFields = {
      botId: context.message.botId,
      transport: context.message.conversation.transport,
      conversationId: context.message.conversation.externalId,
      messageId: context.message.messageId,
      correlationId: context.message.correlationId,
      agentId: context.agent.id,
      skillCount: activatedSkills.length,
      skillNames: activatedSkills.map((skill) => skill.name),
    };

    if (activatedSkills.length > 0) {
      await context.dependencies.logger?.info("resolved bot skills for turn", logFields);
    } else {
      await context.dependencies.logger?.debug("resolved bot skills for turn", logFields);
    }

    context.activatedSkills = activatedSkills;
  } catch (error) {
    void context.dependencies.logger?.error(
      "failed to select bot skills; continuing without skill activation",
      {
        botId: context.message.botId,
        transport: context.message.conversation.transport,
        conversationId: context.message.conversation.externalId,
        messageId: context.message.messageId,
        correlationId: context.message.correlationId,
        agentId: context.agent.id,
      },
      error,
    );
    context.activatedSkills = [];
  }
}

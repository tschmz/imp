import type { InboundProcessingContext } from "./types.js";

export async function dispatchCommand(context: InboundProcessingContext): Promise<void> {
  if (!context.message.command) {
    return;
  }

  const handler = context.availableCommands.find((candidate) =>
    candidate.canHandle(context.message.command),
  );

  if (!handler) {
    return;
  }

  const commandResponse = await handler.handle({
    message: context.message,
    dependencies: {
      ...context.dependencies,
      availableCommands: context.availableCommands,
    },
    logger: context.dependencies.logger,
    loadAppConfig: context.loadAppConfig,
    readRecentLogLines: context.readRecentLogLines,
  });

  if (commandResponse) {
    context.response = commandResponse;
  }
}

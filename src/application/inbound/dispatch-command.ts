import type { IncomingMessageCommand } from "../../domain/message.js";
import { parseInboundCommand } from "../commands/parse-inbound-command.js";
import type { InboundCommandHandler } from "../commands/types.js";
import type { InboundProcessingContext } from "./types.js";

export async function dispatchCommand(context: InboundProcessingContext): Promise<void> {
  const command = resolveCommand(context);
  if (!command) {
    return;
  }

  const handler = context.availableCommands.find((candidate) =>
    candidate.canHandle(command.command),
  );

  if (!handler) {
    return;
  }

  context.message = {
    ...context.message,
    command: command.command,
    ...(command.commandArgs ? { commandArgs: command.commandArgs } : {}),
  };

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

function resolveCommand(
  context: InboundProcessingContext,
): { command: IncomingMessageCommand; commandArgs?: string } | undefined {
  if (context.message.command) {
    return {
      command: context.message.command,
      ...(context.message.commandArgs ? { commandArgs: context.message.commandArgs } : {}),
    };
  }

  return parseInboundCommand(context.message.text, {
    allowedCommands: getAvailableCommandNames(context.availableCommands),
  });
}

function getAvailableCommandNames(commands: ReadonlyArray<InboundCommandHandler>): ReadonlySet<IncomingMessageCommand> {
  return new Set(commands.map((handler) => handler.metadata.name));
}

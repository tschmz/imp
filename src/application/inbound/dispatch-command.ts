import type { IncomingMessageCommand } from "../../domain/message.js";
import { parseInboundCommand } from "../commands/parse-inbound-command.js";
import type { InboundCommandHandler } from "../commands/types.js";
import {
  type InboundHandledContext,
  type InboundProcessingContext,
  withInboundMessage,
  withResponse,
} from "./types.js";

export async function dispatchCommand(
  context: InboundProcessingContext,
): Promise<InboundProcessingContext | InboundHandledContext> {
  const command = resolveCommand(context);
  if (!command) {
    return context;
  }

  const commandContext = withInboundMessage(context, {
    ...context.message,
    command: command.command,
    ...(command.commandArgs ? { commandArgs: command.commandArgs } : {}),
  });

  const handler = context.availableCommands.find((candidate) =>
    candidate.canHandle(command.command),
  );

  if (!handler) {
    return commandContext;
  }

  const commandResponse = await handler.handle({
    message: commandContext.message,
    dependencies: {
      ...commandContext.dependencies,
      availableCommands: commandContext.availableCommands,
    },
    logger: commandContext.dependencies.logger,
    loadAppConfig: commandContext.loadAppConfig,
    readRecentLogLines: commandContext.readRecentLogLines,
  });

  return commandResponse
    ? withResponse(commandContext, commandResponse)
    : commandContext;
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

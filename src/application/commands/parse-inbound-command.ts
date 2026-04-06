import type { IncomingMessageCommand } from "../../domain/message.js";
import { inboundCommandNames } from "./registry.js";

export interface InboundCommandEntity {
  type: string;
  offset: number;
  length: number;
}

export interface ParseInboundCommandOptions {
  allowedCommands?: ReadonlySet<IncomingMessageCommand>;
  botUsername?: string;
  entities?: ReadonlyArray<InboundCommandEntity>;
}

export function parseInboundCommand(
  text: string,
  options: ParseInboundCommandOptions = {},
): { command: IncomingMessageCommand; commandArgs?: string } | undefined {
  const match = parseCommandToken(text, options.entities) ?? parseCommandPrefix(text);
  if (!match?.groups) {
    return undefined;
  }

  const parsedCommand = match.groups.command.toLowerCase();
  const command = (parsedCommand === "start" ? "new" : parsedCommand) as IncomingMessageCommand;
  const allowedCommands = options.allowedCommands ?? inboundCommandNames;
  if (!allowedCommands.has(command)) {
    return undefined;
  }

  if (match.groups.target) {
    if (!options.botUsername || match.groups.target.toLowerCase() !== options.botUsername.toLowerCase()) {
      return undefined;
    }
  }

  return {
    command,
    commandArgs: text.slice(match[0].length).trim() || undefined,
  };
}

function parseCommandToken(
  text: string,
  entities?: ReadonlyArray<InboundCommandEntity>,
): RegExpExecArray | undefined {
  const commandEntity = entities?.find((entity) => entity.type === "bot_command" && entity.offset === 0);
  if (!commandEntity) {
    return undefined;
  }

  return /^\/(?<command>[a-z0-9_]+)(?:@(?<target>[a-z0-9_]+))?$/i.exec(
    text.slice(0, commandEntity.length),
  ) ?? undefined;
}

function parseCommandPrefix(text: string): RegExpExecArray | undefined {
  return /^\/(?<command>[a-z0-9_]+)(?:@(?<target>[a-z0-9_]+))?(?:\s|$)/i.exec(text) ?? undefined;
}

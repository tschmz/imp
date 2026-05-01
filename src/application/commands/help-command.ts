import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

const helpGroupOrder = ["Sessions", "Context", "Diagnostics"] as const;
const commonCommandOrder = ["status", "agent", "new", "history", "help"] as const;

export function renderHelpMessage(handlers: ReadonlyArray<InboundCommandHandler>): string {
  const commandByName = new Map(handlers.map((handler) => [handler.metadata.name, handler]));
  const commonHandlers = commonCommandOrder
    .map((command) => commandByName.get(command))
    .filter((handler): handler is InboundCommandHandler => Boolean(handler));
  const commonNames = new Set(commonHandlers.map((handler) => handler.metadata.name));
  const groupedCommands = helpGroupOrder
    .map((group) => ({
      group,
      handlers: handlers.filter((handler) => handler.metadata.helpGroup === group && !commonNames.has(handler.metadata.name)),
    }))
    .filter(({ handlers }) => handlers.length > 0);

  const lines = ["**Commands**"];

  if (commonHandlers.length > 0) {
    lines.push("", "Common:");
    for (const handler of commonHandlers) {
      lines.push(renderHelpCommandLine(handler));
    }
  }

  groupedCommands.forEach(({ group, handlers }) => {
    lines.push("", `${group}:`);
    for (const handler of handlers) {
      lines.push(renderHelpCommandLine(handler));
    }
  });

  return lines.join("\n");
}

function renderHelpCommandLine(handler: InboundCommandHandler): string {
  const commandLabel = handler.metadata.usage ?? `/${handler.metadata.name}`;
  const description = handler.metadata.helpDescription ?? handler.metadata.description;
  return `\`${commandLabel}\` - ${description}.`;
}

export const helpCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "help",
    description: "Show available commands",
    helpDescription: "Show available commands",
    helpGroup: "Sessions",
  },
  canHandle(command) {
    return command === "help";
  },
  async handle({ message, dependencies }: InboundCommandContext) {
    return {
      conversation: message.conversation,
      text: renderHelpMessage(dependencies.availableCommands ?? [helpCommandHandler]),
    };
  },
};

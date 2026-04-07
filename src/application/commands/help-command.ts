import type { InboundCommandContext, InboundCommandHandler } from "./types.js";

const helpGroupOrder = ["Sessions", "Context", "Diagnostics"] as const;

export function renderHelpMessage(handlers: ReadonlyArray<InboundCommandHandler>): string {
  const groupedCommands = helpGroupOrder
    .map((group) => ({
      group,
      handlers: handlers.filter((handler) => handler.metadata.helpGroup === group),
    }))
    .filter(({ handlers }) => handlers.length > 0);

  const lines = ["Available commands:", ""];

  groupedCommands.forEach(({ group, handlers }, groupIndex) => {
    lines.push(`${group}:`);
    for (const handler of handlers) {
      const commandLabel = handler.metadata.usage ?? `/${handler.metadata.name}`;
      const description = handler.metadata.helpDescription ?? handler.metadata.description;
      lines.push(`${commandLabel} ${description}.`);
    }

    if (groupIndex < groupedCommands.length - 1) {
      lines.push("");
    }
  });

  return lines.join("\n");
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

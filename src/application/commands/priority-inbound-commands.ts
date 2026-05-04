import type { IncomingMessageCommand } from "../../domain/message.js";

export const priorityInboundCommands = new Set<IncomingMessageCommand>([
  "new",
  "resume",
  "previous",
  "status",
  "history",
  "help",
  "ping",
  "whoami",
  "config",
  "agent",
  "logs",
  "rename",
  "delete",
  "reset",
]);

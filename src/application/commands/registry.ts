import { agentCommandHandler } from "./agent-command.js";
import { resetCommandHandler } from "./reset-command.js";
import { configCommandHandler } from "./config-command.js";
import { exportCommandHandler } from "./export-command.js";
import { helpCommandHandler } from "./help-command.js";
import { historyCommandHandler } from "./history-command.js";
import { logsCommandHandler } from "./logs-command.js";
import { newCommandHandler } from "./new-command.js";
import { pingCommandHandler } from "./ping-command.js";
import { reloadCommandHandler } from "./reload-command.js";
import { renameCommandHandler } from "./rename-command.js";
import { restartCommandHandler } from "./restart-command.js";
import { resumeCommandHandler } from "./resume-command.js";
import { statusCommandHandler } from "./status-command.js";
import type { InboundCommandHandler } from "./types.js";
import { whoamiCommandHandler } from "./whoami-command.js";

export const inboundCommandHandlers: InboundCommandHandler[] = [
  newCommandHandler,
  helpCommandHandler,
  pingCommandHandler,
  whoamiCommandHandler,
  statusCommandHandler,
  renameCommandHandler,
  resetCommandHandler,
  historyCommandHandler,
  resumeCommandHandler,
  exportCommandHandler,
  configCommandHandler,
  agentCommandHandler,
  logsCommandHandler,
  reloadCommandHandler,
  restartCommandHandler,
];

export const inboundCommandMenu = inboundCommandHandlers.map((handler) => ({
  command: handler.metadata.name,
  description: handler.metadata.description,
}));

export const inboundCommandNames = new Set(
  inboundCommandHandlers.map((handler) => handler.metadata.name),
);

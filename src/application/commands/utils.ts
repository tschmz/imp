import type { ConversationBackupSummary } from "../../storage/types.js";

export function normalizeCommandArgument(commandArgs?: string): string | undefined {
  const value = commandArgs?.trim();
  return value ? value : undefined;
}

export function parsePositiveIntegerArgument(commandArgs?: string): number | undefined {
  const value = normalizeCommandArgument(commandArgs);
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

export function pickRestoreBackup(
  backups: ConversationBackupSummary[],
  commandArgs?: string,
): ConversationBackupSummary | undefined {
  if (!commandArgs) {
    return undefined;
  }

  const selectedIndex = Number.parseInt(commandArgs.trim(), 10);
  if (!Number.isInteger(selectedIndex) || selectedIndex < 1) {
    return undefined;
  }

  return backups[selectedIndex - 1];
}

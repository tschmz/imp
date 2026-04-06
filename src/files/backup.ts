export function formatBackupTimestamp(date: Date): string {
  return date.toISOString().replaceAll(":", "-");
}

export function createTimestampedBackupPath(path: string, now: Date): string {
  return `${path}.${formatBackupTimestamp(now)}.bak`;
}

import { ConfigurationError } from "../domain/errors.js";

export function validateResolvedToolNames(
  agentId: string,
  namesBySource: {
    builtIn: string[];
    delegation: string[];
    mcp: string[];
  },
): void {
  const counts = new Map<string, number>();
  for (const name of [...namesBySource.builtIn, ...namesBySource.delegation, ...namesBySource.mcp]) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort();

  if (duplicates.length === 0) {
    return;
  }

  throw new ConfigurationError(
    `Duplicate tool names for agent "${agentId}": ${duplicates.join(", ")}. ` +
      "Tool names must be unique across built-in tools, delegated agent tools, and MCP tools.",
  );
}

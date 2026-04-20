import { readFileSync } from "node:fs";

export const DEFAULT_AGENT_SYSTEM_PROMPT = readFileSync(
  new URL("../../assets/agents/default-system-prompt.md", import.meta.url),
  "utf8",
).trim();

import type { ToolDefinition } from "./types.js";

export interface ToolRegistry {
  list(): ToolDefinition[];
  get(name: string): ToolDefinition | undefined;
  pick(names: string[]): ToolDefinition[];
}

export function createToolRegistry(tools: ToolDefinition[]): ToolRegistry {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    list() {
      return tools.slice();
    },
    get(name) {
      return byName.get(name);
    },
    pick(names) {
      return names.flatMap((name) => {
        const tool = byName.get(name);
        return tool ? [tool] : [];
      });
    },
  };
}

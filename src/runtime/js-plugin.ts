import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { PluginManifest } from "../plugins/manifest.js";
import type { ToolDefinition } from "../tools/types.js";
import { toUserVisibleToolError } from "./user-visible-tool-error.js";

export interface JsPluginRuntimeConfig {
  pluginId: string;
  pluginRoot: string;
  modulePath: string;
}

export interface PluginRuntimeContext {
  plugin: {
    id: string;
    rootDir: string;
  };
}

export interface JsPluginRegistration {
  tools?: JsPluginToolDefinition[];
}

export type JsPluginInitializer = (context: PluginRuntimeContext) => Promise<JsPluginRegistration> | JsPluginRegistration;

export type JsPluginToolDefinition = ToolDefinition;

interface JsPluginModuleShape {
  default?: unknown;
  registerPlugin?: unknown;
  tools?: unknown;
}

export function resolvePluginJsRuntime(manifest: PluginManifest, pluginRoot: string): JsPluginRuntimeConfig | undefined {
  if (!manifest.runtime) {
    return undefined;
  }

  return {
    pluginId: manifest.id,
    pluginRoot,
    modulePath: resolve(pluginRoot, manifest.runtime.module),
  };
}

export async function loadJsPluginToolDefinitions(plugins: JsPluginRuntimeConfig[]): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];
  const names = new Set<string>();

  for (const plugin of plugins) {
    const registration = await loadJsPluginRegistration(plugin);
    for (const tool of registration.tools ?? []) {
      const namespacedTool = namespaceJsPluginTool(plugin, tool);
      if (names.has(namespacedTool.name)) {
        throw new Error(`Duplicate JS plugin tool name "${namespacedTool.name}".`);
      }
      names.add(namespacedTool.name);
      tools.push(namespacedTool);
    }
  }

  return tools;
}

async function loadJsPluginRegistration(plugin: JsPluginRuntimeConfig): Promise<JsPluginRegistration> {
  const loaded = await import(pathToFileURL(plugin.modulePath).href).catch((error: unknown) => {
    throw new Error(`Could not load JS plugin "${plugin.pluginId}" from ${plugin.modulePath}: ${formatError(error)}`);
  }) as JsPluginModuleShape;

  const context: PluginRuntimeContext = {
    plugin: {
      id: plugin.pluginId,
      rootDir: plugin.pluginRoot,
    },
  };

  if (typeof loaded.registerPlugin === "function") {
    return parseRegistration(await loaded.registerPlugin(context), plugin);
  }

  if (typeof loaded.default === "function") {
    return parseRegistration(await loaded.default(context), plugin);
  }

  if (isRecord(loaded.default)) {
    return parseRegistration(loaded.default, plugin);
  }

  if (Array.isArray(loaded.tools)) {
    return parseRegistration({ tools: loaded.tools }, plugin);
  }

  throw new Error(
    `JS plugin "${plugin.pluginId}" must export registerPlugin(context), a default initializer, a default registration object, or a tools array.`,
  );
}

function parseRegistration(value: unknown, plugin: JsPluginRuntimeConfig): JsPluginRegistration {
  if (!isRecord(value)) {
    throw new Error(`JS plugin "${plugin.pluginId}" returned an invalid registration object.`);
  }

  const tools = value.tools;
  if (tools === undefined) {
    return {};
  }

  if (!Array.isArray(tools)) {
    throw new Error(`JS plugin "${plugin.pluginId}" registration field "tools" must be an array.`);
  }

  return {
    tools: tools.map((tool, index) => parseJsPluginTool(tool, plugin, index)),
  };
}

function parseJsPluginTool(value: unknown, plugin: JsPluginRuntimeConfig, index: number): JsPluginToolDefinition {
  if (!isRecord(value)) {
    throw new Error(`JS plugin "${plugin.pluginId}" tool ${index + 1} must be an object.`);
  }

  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new Error(`JS plugin "${plugin.pluginId}" tool ${index + 1} must define a non-empty name.`);
  }

  if (typeof value.description !== "string" || value.description.length === 0) {
    throw new Error(`JS plugin "${plugin.pluginId}" tool "${value.name}" must define a non-empty description.`);
  }

  if (typeof value.execute !== "function") {
    throw new Error(`JS plugin "${plugin.pluginId}" tool "${value.name}" must define an execute function.`);
  }

  return value as unknown as JsPluginToolDefinition;
}

function namespaceJsPluginTool(plugin: JsPluginRuntimeConfig, tool: JsPluginToolDefinition): ToolDefinition {
  const fullName = tool.name.includes(".") ? tool.name : `${plugin.pluginId}.${tool.name}`;

  return {
    ...tool,
    name: fullName,
    label: tool.label ?? fullName,
    async execute(toolCallId, params, signal, onUpdate) {
      return Promise.resolve()
        .then(() => tool.execute(toolCallId, params, signal, onUpdate))
        .catch((error: unknown) => {
          throw toUserVisibleToolError(error, {
            fallbackMessage: `JS plugin tool "${fullName}" failed.`,
            defaultKind: "tool_command_execution",
          });
        });
    },
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseConfigJson } from "../config/config-json.js";
import { loadPluginConfigContributions } from "../config/plugin-runtime.js";
import { appConfigSchema } from "../config/schema.js";
import { discoverConfigPath } from "../config/discover-config-path.js";
import { resolveConfigPath } from "../config/secret-value.js";
import type { AgentConfig, AppConfig } from "../config/types.js";
import { getValueAtKeyPath, setValueAtKeyPath } from "./config-key-path.js";

interface SetConfigValueUseCaseDependencies {
  writeOutput: (line: string) => void;
}

export function createSetConfigValueUseCase(
  dependencies: Partial<SetConfigValueUseCaseDependencies> = {},
): (options: {
  configPath?: string;
  keyPath: string;
  value: string;
}) => Promise<void> {
  const deps: SetConfigValueUseCaseDependencies = {
    writeOutput: console.log,
    ...dependencies,
  };

  return async ({ configPath, keyPath, value }) => {
    const resolvedConfigPath = await resolveWritableConfigPath(configPath);
    const raw = await readFile(resolvedConfigPath, "utf8");
    const parsed = parseConfigJson(raw, {
      errorPrefix: `Invalid input config file ${resolvedConfigPath}`,
    });

    const parsedValue = parseConfigValue(value);
    await materializePluginAgentOverride(parsed, resolvedConfigPath, keyPath);

    try {
      setValueAtKeyPath(parsed, keyPath, parsedValue);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid target key path: ${keyPath}\n${message}`);
    }

    assertUpdatedConfigIsValid(parsed, resolvedConfigPath, keyPath, parsedValue);

    await writeFile(resolvedConfigPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    deps.writeOutput(`Updated config ${resolvedConfigPath}: ${keyPath}`);
  };
}

async function materializePluginAgentOverride(
  config: unknown,
  configPath: string,
  keyPath: string,
): Promise<void> {
  const keyPathSegments = keyPath.split(".");
  if (keyPathSegments[0] !== "agents" || keyPathSegments.length < 2) {
    return;
  }

  if (!isRecord(config) || !Array.isArray(config.agents)) {
    return;
  }

  const agentPathSegments = keyPathSegments.slice(1);
  if (findTargetAgentId(agentPathSegments, config.agents)) {
    return;
  }

  const configDir = dirname(configPath);
  const appConfig = parseAppConfigForPluginLookup(config, configPath);
  const pluginConfig = await loadPluginConfigContributions(appConfig, configDir);
  const pluginAgentId = findTargetAgentId(agentPathSegments, pluginConfig.agents);
  if (!pluginAgentId) {
    return;
  }

  const pluginAgent = pluginConfig.agents.find((agent) => agent.id === pluginAgentId);
  if (!pluginAgent) {
    return;
  }

  config.agents.push(createPluginAgentOverride(pluginAgent, appConfig, agentPathSegments));
}

function parseAppConfigForPluginLookup(config: unknown, configPath: string): AppConfig {
  const result = appConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      formatSchemaError(`Config update cannot resolve plugin agents from invalid config: ${configPath}`, result.error.issues),
    );
  }

  const configDir = dirname(configPath);
  return {
    ...result.data,
    paths: {
      ...result.data.paths,
      dataRoot: resolveConfigPath(result.data.paths.dataRoot, configDir),
    },
  };
}

function createPluginAgentOverride(
  pluginAgent: AgentConfig,
  appConfig: AppConfig,
  agentPathSegments: string[],
): AgentConfig {
  const agent = structuredClone(pluginAgent) as AgentConfig;
  const remainingSegments = agentPathSegments.slice(pluginAgent.id.split(".").length);
  if (remainingSegments[0] === "model" && !agent.model && appConfig.defaults.model) {
    agent.model = structuredClone(appConfig.defaults.model) as NonNullable<AgentConfig["model"]>;
  }

  return agent;
}

function findTargetAgentId(agentPathSegments: string[], agents: unknown[]): string | undefined {
  const [firstSegment] = agentPathSegments;
  if (firstSegment === undefined || firstSegment === "*") {
    return undefined;
  }

  const numericIndex = Number(firstSegment);
  if (Number.isInteger(numericIndex) && String(numericIndex) === firstSegment) {
    const agent = agents[numericIndex];
    return getAgentId(agent);
  }

  return agents
    .map((agent) => getAgentId(agent))
    .filter((id): id is string => id !== undefined)
    .sort((left, right) => right.split(".").length - left.split(".").length)
    .find((id) => isPathPrefix(agentPathSegments, id.split(".")));
}

function isPathPrefix(segments: string[], prefix: string[]): boolean {
  return prefix.length <= segments.length && prefix.every((segment, index) => segments[index] === segment);
}

function getAgentId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.id === "string" ? value.id : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function resolveWritableConfigPath(configPath?: string): Promise<string> {
  if (!configPath) {
    const discovery = await discoverConfigPath();
    return discovery.configPath;
  }

  const resolvedConfigPath = resolve(configPath);

  try {
    await access(resolvedConfigPath);
  } catch {
    throw new Error(`Config file not found: ${resolvedConfigPath}`);
  }

  return resolvedConfigPath;
}

function assertUpdatedConfigIsValid(
  config: unknown,
  configPath: string,
  keyPath: string,
  targetValue: unknown,
): void {
  const result = appConfigSchema.safeParse(config);

  if (!result.success) {
    throw new Error(
      formatSchemaError(`Config update violates schema: ${configPath}`, result.error.issues),
    );
  }

  const acceptedValue = getValueAtKeyPath(result.data, keyPath);
  if (!isDeepStrictEqual(acceptedValue, targetValue)) {
    throw new Error(
      [
        `Config update targets an unsupported key path or value: ${keyPath}`,
        "The updated value was not accepted by the config schema.",
      ].join("\n"),
    );
  }
}

function formatSchemaError(
  prefix: string,
  issues: Array<{ path: PropertyKey[]; message: string }>,
): string {
  const details = issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`).join("\n");
  return `${prefix}\n${details}`;
}

function formatIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) {
    return "<root>";
  }

  let formatted = "";

  for (const segment of path) {
    if (typeof segment === "number") {
      formatted += `[${segment}]`;
      continue;
    }

    if (typeof segment === "string") {
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(segment)) {
        formatted += formatted.length === 0 ? segment : `.${segment}`;
      } else {
        formatted += `[${JSON.stringify(segment)}]`;
      }
      continue;
    }

    formatted += `[${String(segment)}]`;
  }

  return formatted;
}

function parseConfigValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

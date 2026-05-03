import { delimiter as pathDelimiter } from "node:path";
import type { AgentDefinition } from "../domain/agent.js";
import type { BashToolOptions } from "./tools/bash-tool.js";

export function resolveBuiltInToolOptions(agent?: AgentDefinition): { bash?: BashToolOptions } | undefined {
  const shellPath = agent?.workspace?.shellPath;
  if (!shellPath || shellPath.length === 0) {
    return undefined;
  }

  return {
    bash: {
      spawnHook: ({ command, cwd, env }) => ({
        command,
        cwd,
        env: mergeShellPathEntries(env, shellPath),
      }),
    },
  };
}

export function mergeShellPathEntries(
  env: NodeJS.ProcessEnv,
  additionalEntries: string[],
  options: { delimiter?: string; platform?: NodeJS.Platform } = {},
): NodeJS.ProcessEnv {
  const delimiter = options.delimiter ?? pathDelimiter;
  const platform = options.platform ?? process.platform;
  const pathKey = resolvePathEnvironmentKey(env, platform);
  const currentPath = env[pathKey];
  const envWithoutDuplicatePathKeys = removeDuplicatePathKeys(env, platform);

  return {
    ...envWithoutDuplicatePathKeys,
    [pathKey]: appendPathEntries(currentPath, additionalEntries, delimiter),
  };
}

function resolvePathEnvironmentKey(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    if ("Path" in env) {
      return "Path";
    }

    if ("PATH" in env) {
      return "PATH";
    }

    const existingKey = Object.keys(env).find((key) => key.toLowerCase() === "path");
    if (existingKey) {
      return existingKey;
    }

    return "Path";
  }

  return "PATH";
}

function removeDuplicatePathKeys(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  if (platform !== "win32") {
    return env;
  }

  return Object.fromEntries(
    Object.entries(env).filter(([key]) => key.toLowerCase() !== "path"),
  );
}

function appendPathEntries(
  currentPath: string | undefined,
  additionalEntries: string[],
  delimiter: string,
): string {
  const mergedEntries = [
    ...additionalEntries,
    ...splitPathEntries(currentPath, delimiter),
  ];

  return [...new Set(mergedEntries)].join(delimiter);
}

function splitPathEntries(pathValue: string | undefined, delimiter: string): string[] {
  if (!pathValue) {
    return [];
  }

  return pathValue
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

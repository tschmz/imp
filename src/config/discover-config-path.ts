import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

export interface ConfigPathDiscovery {
  configPath: string;
  checkedPaths: string[];
}

export async function discoverConfigPath(options: {
  cliConfigPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<ConfigPathDiscovery> {
  const candidates = getConfigPathCandidates(options);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return {
        configPath: candidate,
        checkedPaths: candidates,
      };
    }
  }

  throw new Error(buildMissingConfigMessage(candidates, options.env));
}

function getConfigPathCandidates(options: {
  cliConfigPath?: string;
  env?: NodeJS.ProcessEnv;
}): string[] {
  const env = options.env ?? process.env;
  const candidates: string[] = [];

  if (options.cliConfigPath) {
    candidates.push(resolve(options.cliConfigPath));
  }

  if (env.IMP_CONFIG_PATH) {
    candidates.push(resolve(env.IMP_CONFIG_PATH));
  }

  const xdgConfigHome = env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    candidates.push(resolve(xdgConfigHome, "imp", "config.json"));
  }

  candidates.push(getDefaultUserConfigPath(env));
  candidates.push("/etc/imp/config.json");

  return Array.from(new Set(candidates));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function buildMissingConfigMessage(
  checkedPaths: string[],
  env: NodeJS.ProcessEnv = process.env,
): string {
  const checked = checkedPaths.map((path) => `- ${path}`).join("\n");
  const recommendedPath = getDefaultUserConfigPath(env);

  return [
    "No config file found.",
    "Checked:",
    checked,
    "",
    "Create a config at:",
    `- ${recommendedPath}`,
    "",
    "Or start with:",
    "- imp daemon run --config /path/to/config.json",
  ].join("\n");
}

export function getDefaultUserConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdgConfigHome = env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return resolve(xdgConfigHome, "imp", "config.json");
  }

  return resolve(homedir(), ".config", "imp", "config.json");
}

export function getDefaultUserDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const xdgStateHome = env.XDG_STATE_HOME;
  if (xdgStateHome) {
    return resolve(xdgStateHome, "imp");
  }

  return resolve(homedir(), ".local", "state", "imp");
}

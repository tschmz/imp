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

  throw new Error(buildMissingConfigMessage(candidates));
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

  candidates.push(resolve(homedir(), ".config", "imp", "config.json"));
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

function buildMissingConfigMessage(checkedPaths: string[]): string {
  const checked = checkedPaths.map((path) => `- ${path}`).join("\n");
  const recommendedPath = resolve(homedir(), ".config", "imp", "config.json");

  return [
    "No config file found.",
    "Checked:",
    checked,
    "",
    "Create a config at:",
    `- ${recommendedPath}`,
    "",
    "Or start with:",
    "- imp --config /path/to/config.json",
  ].join("\n");
}

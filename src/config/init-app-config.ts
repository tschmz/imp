import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultAppConfig } from "./default-app-config.js";
import { getDefaultUserConfigPath } from "./discover-config-path.js";
import { assertManagedFileCanBeWritten, writeManagedFile } from "../files/managed-file.js";
import { appConfigSchema } from "./schema.js";
import type { AppConfig } from "./types.js";
import { resolveConfigPath as resolvePathRelativeToConfig } from "./secret-value.js";
import { loadAppConfig } from "./load-app-config.js";
import { isMissingFileError } from "../files/node-error.js";

const ownerReadWriteMode = 0o600;
const defaultManagedSkillFileMode = 0o644;
const bundledSkillsRoot = fileURLToPath(new URL("../../assets/skills", import.meta.url));

interface ManagedSkillFile {
  relativePath: string;
  sourcePath: string;
  targetPath: string;
  mode: number;
}

export async function initAppConfig(options: {
  configPath?: string;
  force?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  config?: AppConfig;
} = {}): Promise<string> {
  const env = options.env ?? process.env;
  const configPath = resolveConfigPath({ configPath: options.configPath, env });
  const config = appConfigSchema.parse(options.config ?? createDefaultAppConfig(env));
  const managedSkillFiles = await discoverManagedSkillFiles(config, configPath);

  await assertManagedFileCanBeWritten({
    path: configPath,
    resourceLabel: "Config file",
    force: options.force,
  });
  for (const file of managedSkillFiles) {
    await assertManagedFileCanBeWritten({
      path: file.targetPath,
      resourceLabel: getManagedSkillResourceLabel(file),
      force: options.force,
    });
  }

  const writtenConfigPath = await writeManagedFile({
    path: configPath,
    resourceLabel: "Config file",
    content: `${JSON.stringify(config, null, 2)}\n`,
    force: options.force,
    now: options.now,
    mode: ownerReadWriteMode,
  });

  for (const file of managedSkillFiles) {
    await writeManagedSkillFile(file, {
      force: options.force,
      now: options.now,
    });
  }

  return writtenConfigPath;
}

export async function syncManagedSkills(options: {
  configPath: string;
  now?: Date;
}): Promise<string[]> {
  const configPath = resolve(options.configPath);
  const config = await loadAppConfig(configPath);
  const managedSkillFiles = await discoverManagedSkillFiles(config, configPath);

  for (const file of managedSkillFiles) {
    await writeManagedSkillFile(file, {
      force: true,
      now: options.now,
    });
  }

  return managedSkillFiles
    .filter((file) => file.relativePath === "SKILL.md")
    .map((file) => file.targetPath);
}

export async function assertInitConfigCanBeCreated(options: {
  configPath?: string;
  force?: boolean;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<string> {
  return assertManagedFileCanBeWritten({
    path: resolveConfigPath(options),
    resourceLabel: "Config file",
    force: options.force,
  });
}

function resolveConfigPath(options: {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = options.env ?? process.env;
  return resolve(options.configPath ?? getDefaultUserConfigPath(env));
}

function resolveManagedSkillsRoot(config: AppConfig, configPath: string): string {
  const dataRoot = resolvePathRelativeToConfig(config.paths.dataRoot, dirname(configPath));
  return join(dataRoot, "skills");
}

async function discoverManagedSkillFiles(config: AppConfig, configPath: string): Promise<ManagedSkillFile[]> {
  const targetRoot = resolveManagedSkillsRoot(config, configPath);
  const entries = await readdir(bundledSkillsRoot, { withFileTypes: true });
  const files: ManagedSkillFile[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      continue;
    }

    const sourceSkillRoot = join(bundledSkillsRoot, entry.name);
    if (!(await hasSkillManifest(sourceSkillRoot))) {
      continue;
    }

    for (const sourcePath of await listFilesRecursive(sourceSkillRoot)) {
      const relativePath = relative(sourceSkillRoot, sourcePath);
      const sourceStats = await stat(sourcePath);
      files.push({
        relativePath,
        sourcePath,
        targetPath: join(targetRoot, entry.name, relativePath),
        mode: resolveManagedSkillFileMode(sourceStats.mode & 0o777),
      });
    }
  }

  return files.sort((left, right) => left.targetPath.localeCompare(right.targetPath));
}

async function hasSkillManifest(sourceSkillRoot: string): Promise<boolean> {
  try {
    await access(join(sourceSkillRoot, "SKILL.md"));
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(path));
      continue;
    }
    if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
}

async function writeManagedSkillFile(
  file: ManagedSkillFile,
  options: {
    force?: boolean;
    now?: Date;
  },
): Promise<void> {
  await writeManagedFile({
    path: file.targetPath,
    resourceLabel: getManagedSkillResourceLabel(file),
    content: await readFile(file.sourcePath, "utf8"),
    force: options.force,
    now: options.now,
    mode: file.mode,
  });
}

function getManagedSkillResourceLabel(file: ManagedSkillFile): string {
  return file.relativePath === "SKILL.md" ? "Imp skill" : "Imp skill resource";
}

function resolveManagedSkillFileMode(sourceMode: number): number {
  return (sourceMode & 0o111) === 0 ? defaultManagedSkillFileMode : sourceMode;
}

import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { AppConfig } from "../config/types.js";

export interface BackupAgentFileEntry {
  archivePath: string;
  sourcePath: string;
  configRelativePath?: string;
  agentId: string;
  reference:
    | "prompt.base.file"
    | "prompt.instructions[].file"
    | "prompt.references[].file"
    | "defaults.model.authFile"
    | "model.authFile";
}

export interface BackupAgentHomeEntry {
  archivePath: string;
  sourcePath: string;
  configRelativePath?: string;
  agentId: string;
}

export interface BackupAgentAssetManifest {
  source: {
    configPath: string;
    dataRoot: string;
  };
  agentFiles?: BackupAgentFileEntry[];
  agentHomes?: BackupAgentHomeEntry[];
}

export interface CollectedBackupAgentAssets {
  files: Array<Omit<BackupAgentFileEntry, "archivePath">>;
  homes: Array<Omit<BackupAgentHomeEntry, "archivePath">>;
}

export function collectBackupAgentAssets(
  appConfig: AppConfig,
  configPath: string,
): CollectedBackupAgentAssets {
  const configDir = dirname(configPath);
  const files = new Map<string, Omit<BackupAgentFileEntry, "archivePath">>();
  const homes = new Map<string, Omit<BackupAgentHomeEntry, "archivePath">>();

  addAgentFile(files, {
    agentId: appConfig.defaults.agentId,
    reference: "defaults.model.authFile",
    configDir,
    configuredPath: appConfig.defaults.model?.authFile,
  });

  for (const agent of appConfig.agents) {
    addAgentFile(files, {
      agentId: agent.id,
      reference: "prompt.base.file",
      configDir,
      configuredPath: agent.prompt?.base?.file,
    });

    for (const source of agent.prompt?.instructions ?? []) {
      addAgentFile(files, {
        agentId: agent.id,
        reference: "prompt.instructions[].file",
        configDir,
        configuredPath: source.file,
      });
    }

    for (const source of agent.prompt?.references ?? []) {
      addAgentFile(files, {
        agentId: agent.id,
        reference: "prompt.references[].file",
        configDir,
        configuredPath: source.file,
      });
    }

    addAgentFile(files, {
      agentId: agent.id,
      reference: "model.authFile",
      configDir,
      configuredPath: agent.model?.authFile,
    });

    const configuredHome = agent.home ?? join(appConfig.paths.dataRoot, "agents", agent.id);
    const sourcePath = resolveConfigPath(configuredHome, configDir);
    if (!homes.has(sourcePath)) {
      homes.set(sourcePath, {
        agentId: agent.id,
        sourcePath,
        ...(agent.home && !isAbsolute(agent.home) ? { configRelativePath: toPortablePath(agent.home) } : {}),
      });
    }
  }

  return {
    files: [...files.values()].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
    homes: [...homes.values()].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
  };
}

export async function assertBackupAgentFileIsReadable(
  entry: Omit<BackupAgentFileEntry, "archivePath">,
): Promise<void> {
  let fileStat;
  try {
    fileStat = await stat(entry.sourcePath);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new Error(
        `Referenced agent file not found for agent "${entry.agentId}" at ${entry.reference}: ${entry.sourcePath}`,
      );
    }

    throw error;
  }

  if (!fileStat.isFile()) {
    throw new Error(
      `Referenced agent file is not a regular file for agent "${entry.agentId}" at ${entry.reference}: ${entry.sourcePath}`,
    );
  }
}

export async function shouldIncludeBackupAgentHome(
  entry: Omit<BackupAgentHomeEntry, "archivePath">,
): Promise<boolean> {
  let homeStat;
  try {
    homeStat = await stat(entry.sourcePath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw error;
  }

  if (!homeStat.isDirectory()) {
    throw new Error(`Agent home is not a directory for agent "${entry.agentId}": ${entry.sourcePath}`);
  }

  return true;
}

export function createBackupAgentAssetRelocator(
  manifest: BackupAgentAssetManifest,
  options: {
    targetConfigPath?: string;
    targetDataRoot?: string;
  },
): {
  relocateArchivedFile(entry: BackupAgentFileEntry): string;
  relocateArchivedHome(entry: BackupAgentHomeEntry): string;
  relocateConfiguredFilePath(configuredPath: string | undefined, sourceConfigDir: string): string | undefined;
  relocateConfiguredAgentHome(configuredPath: string, sourceConfigDir: string): string;
  isFileContainedInArchivedHome(sourcePath: string): boolean;
} {
  const relocateArchivedHome = (entry: BackupAgentHomeEntry): string => {
    if (entry.configRelativePath && options.targetConfigPath) {
      return resolve(dirname(options.targetConfigPath), entry.configRelativePath);
    }

    return relocateSourcePathByKnownRoots(entry.sourcePath, manifest, options) ?? entry.sourcePath;
  };

  const relocateArchivedFile = (entry: BackupAgentFileEntry): string => {
    const containingHome = findContainingAgentHome(manifest, entry.sourcePath);
    if (containingHome) {
      const relativeToHome = relativeIfContainedOrSelf(containingHome.sourcePath, entry.sourcePath);
      const targetHome = relocateArchivedHome(containingHome);
      return relativeToHome ? resolve(targetHome, relativeToHome) : targetHome;
    }

    if (entry.configRelativePath && options.targetConfigPath) {
      return resolve(dirname(options.targetConfigPath), entry.configRelativePath);
    }

    return relocateSourcePathByKnownRoots(entry.sourcePath, manifest, options) ?? entry.sourcePath;
  };

  const relocationMap = new Map<string, string>();
  for (const entry of manifest.agentFiles ?? []) {
    relocationMap.set(entry.sourcePath, relocateArchivedFile(entry));
  }

  return {
    relocateArchivedFile,
    relocateArchivedHome,
    relocateConfiguredFilePath(configuredPath, sourceConfigDir) {
      if (!configuredPath) {
        return undefined;
      }

      const resolvedSourcePath = resolveConfigPath(configuredPath, sourceConfigDir);
      const relocatedPath = relocationMap.get(resolvedSourcePath);
      if (!relocatedPath) {
        return configuredPath;
      }

      return isAbsolute(configuredPath) ? relocatedPath : configuredPath;
    },
    relocateConfiguredAgentHome(configuredPath, sourceConfigDir) {
      if (!isAbsolute(configuredPath)) {
        return configuredPath;
      }

      const resolvedSourcePath = resolveConfigPath(configuredPath, sourceConfigDir);
      const archivedHome = findArchivedAgentHome(manifest, resolvedSourcePath);
      if (archivedHome) {
        return relocateArchivedHome(archivedHome);
      }

      return relocateSourcePathByKnownRoots(resolvedSourcePath, manifest, options) ?? configuredPath;
    },
    isFileContainedInArchivedHome(sourcePath) {
      return findContainingAgentHome(manifest, sourcePath) !== undefined;
    },
  };
}

function addAgentFile(
  files: Map<string, Omit<BackupAgentFileEntry, "archivePath">>,
  options: {
    agentId: string;
    reference: BackupAgentFileEntry["reference"];
    configDir: string;
    configuredPath?: string;
  },
): void {
  if (!options.configuredPath) {
    return;
  }

  const sourcePath = resolveConfigPath(options.configuredPath, options.configDir);
  if (files.has(sourcePath)) {
    return;
  }

  files.set(sourcePath, {
    agentId: options.agentId,
    reference: options.reference,
    sourcePath,
    ...(isAbsolute(options.configuredPath) ? {} : { configRelativePath: toPortablePath(options.configuredPath) }),
  });
}

function relocateSourcePathByKnownRoots(
  sourcePath: string,
  manifest: BackupAgentAssetManifest,
  options: {
    targetConfigPath?: string;
    targetDataRoot?: string;
  },
): string | undefined {
  const sourceDataRootRelativePath = relativeIfContainedOrSelf(manifest.source.dataRoot, sourcePath);
  if (sourceDataRootRelativePath !== undefined && options.targetDataRoot) {
    return resolve(options.targetDataRoot, sourceDataRootRelativePath);
  }

  const sourceConfigDirRelativePath = relativeIfContainedOrSelf(dirname(manifest.source.configPath), sourcePath);
  if (sourceConfigDirRelativePath !== undefined && options.targetConfigPath) {
    return resolve(dirname(options.targetConfigPath), sourceConfigDirRelativePath);
  }

  return undefined;
}

function findArchivedAgentHome(
  manifest: BackupAgentAssetManifest,
  sourcePath: string,
): BackupAgentHomeEntry | undefined {
  return (manifest.agentHomes ?? []).find((entry) => resolve(entry.sourcePath) === resolve(sourcePath));
}

function findContainingAgentHome(
  manifest: BackupAgentAssetManifest,
  sourcePath: string,
): BackupAgentHomeEntry | undefined {
  let containingHome: BackupAgentHomeEntry | undefined;

  for (const entry of manifest.agentHomes ?? []) {
    if (relativeIfContainedOrSelf(entry.sourcePath, sourcePath) === undefined) {
      continue;
    }

    if (!containingHome || resolve(entry.sourcePath).length > resolve(containingHome.sourcePath).length) {
      containingHome = entry;
    }
  }

  return containingHome;
}

function relativeIfContainedOrSelf(rootPath: string, candidatePath: string): string | undefined {
  const relativePath = relative(resolve(rootPath), resolve(candidatePath));
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return undefined;
  }

  return relativePath;
}

function resolveConfigPath(path: string, configDir: string): string {
  return isAbsolute(path) ? path : resolve(configDir, path);
}

function toPortablePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

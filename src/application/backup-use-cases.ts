import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { discoverConfigPath, getDefaultUserConfigPath } from "../config/discover-config-path.js";
import { loadAppConfig } from "../config/load-app-config.js";
import type { AppConfig } from "../config/types.js";
import { assertManagedFileCanBeWritten, writeManagedFile } from "../files/managed-file.js";
import { createTarArchive, extractTarArchive } from "../files/tar-archive.js";

export interface BackupUseCases {
  createBackup: (options: BackupCreateOptions) => Promise<void>;
  restoreBackup: (options: BackupRestoreOptions) => Promise<void>;
}

export interface BackupCreateOptions {
  configPath?: string;
  outputPath?: string;
  only?: string;
  force: boolean;
}

export interface BackupRestoreOptions {
  configPath?: string;
  dataRoot?: string;
  inputPath: string;
  only?: string;
  force: boolean;
}

export type BackupScope = "config" | "agents" | "conversations";

interface BackupManifest {
  version: 1;
  createdAt: string;
  scopes: BackupScope[];
  source: {
    configPath: string;
    dataRoot: string;
  };
  config?: {
    archivePath: string;
  };
  agentFiles?: BackupAgentFileEntry[];
  conversations?: BackupConversationEntry[];
}

interface BackupAgentFileEntry {
  archivePath: string;
  sourcePath: string;
  configRelativePath?: string;
  agentId: string;
  reference: "prompt.base.file" | "prompt.instructions[].file" | "prompt.references[].file" | "authFile";
}

interface BackupConversationEntry {
  archivePath: string;
  botId: string;
  relativeToDataRoot: string;
}

interface BackupDependencies {
  discoverConfigPath: typeof discoverConfigPath;
  getDefaultUserConfigPath: typeof getDefaultUserConfigPath;
  loadAppConfig: typeof loadAppConfig;
  writeOutput: (line: string) => void;
}

export function createBackupUseCases(dependencies: Partial<BackupDependencies> = {}): BackupUseCases {
  const deps: BackupDependencies = {
    discoverConfigPath,
    getDefaultUserConfigPath,
    loadAppConfig,
    writeOutput: console.log,
    ...dependencies,
  };

  return {
    createBackup: async ({ configPath, outputPath, only, force }) => {
      const { configPath: resolvedConfigPath } = await deps.discoverConfigPath({
        cliConfigPath: configPath,
      });
      const appConfig = await deps.loadAppConfig(resolvedConfigPath);
      const selection = parseScopeSelection(only);
      const resolvedOutputPath = resolveBackupOutputPath(outputPath, resolvedConfigPath);
      const stageRoot = await mkdtemp(join(tmpdir(), "imp-backup-"));

      try {
        const archiveRoot = join(stageRoot, "archive");
        const manifest = await stageBackup({
          archiveRoot,
          appConfig,
          configPath: resolvedConfigPath,
          selection,
        });

        await writeFile(join(archiveRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        await assertManagedFileCanBeWritten({
          path: resolvedOutputPath,
          resourceLabel: "Backup archive",
          force,
        });
        await createTarArchive(archiveRoot, resolvedOutputPath);

        deps.writeOutput(`Created backup at ${resolvedOutputPath}`);
        deps.writeOutput(`Scopes: ${manifest.scopes.join(", ")}`);
      } finally {
        await rm(stageRoot, { recursive: true, force: true });
      }
    },
    restoreBackup: async ({ configPath, dataRoot, inputPath, only, force }) => {
      const resolvedInputPath = resolve(inputPath);
      const selection = parseScopeSelection(only);
      const stageRoot = await mkdtemp(join(tmpdir(), "imp-restore-"));

      try {
        await extractTarArchive(resolvedInputPath, stageRoot);
        const manifest = await readBackupManifest(stageRoot);
        assertManifestContainsRequestedScopes(manifest, selection);

        const archiveConfig = manifest.config ? await readArchivedConfig(stageRoot, manifest) : undefined;
        const targetConfigPath = await resolveTargetConfigPath({
          cliConfigPath: configPath,
          selection,
          discoverConfigPath: deps.discoverConfigPath,
          getDefaultUserConfigPath: deps.getDefaultUserConfigPath,
        });
        const currentTargetConfig =
          !selection.config && targetConfigPath ? await loadOptionalAppConfig(deps.loadAppConfig, targetConfigPath) : undefined;
        const restoredConfig = archiveConfig
          ? applyConfigRestoreOverrides(archiveConfig, {
              dataRoot,
              manifest,
              targetConfigPath,
            })
          : undefined;
        const targetDataRoot = resolveTargetDataRoot({
          cliDataRoot: dataRoot,
          currentTargetConfig,
          restoredConfig,
          archiveConfig,
          selection,
        });

        if (selection.config) {
          if (!targetConfigPath || !restoredConfig) {
            throw new Error("Config restore requires a config file to be present in the backup archive.");
          }

          await writeManagedFile({
            path: targetConfigPath,
            resourceLabel: "Config file",
            content: `${JSON.stringify(restoredConfig, null, 2)}\n`,
            force,
          });
        }

        if (selection.agents) {
          if (!targetConfigPath || (!selection.config && !currentTargetConfig)) {
            throw new Error(
              "Agent file restore requires either restoring config in the same command or pointing --config at an existing target config file.",
            );
          }

          await restoreAgentFiles({
            stageRoot,
            manifest,
            targetConfigPath,
            targetDataRoot,
            force,
          });
        }

        if (selection.conversations) {
          if (!targetDataRoot) {
            throw new Error(
              "Conversation restore requires --data-root, a restorable config in the backup, or an existing discovered config path.",
            );
          }

          await restoreConversationTrees({
            stageRoot,
            manifest,
            targetDataRoot,
            force,
          });
        }

        deps.writeOutput(`Restored backup from ${resolvedInputPath}`);
        deps.writeOutput(`Scopes: ${selectedManifestScopes(manifest, selection).join(", ")}`);
        if (targetConfigPath) {
          deps.writeOutput(`Config: ${targetConfigPath}`);
        }
        if (targetDataRoot) {
          deps.writeOutput(`Data root: ${targetDataRoot}`);
        }
      } finally {
        await rm(stageRoot, { recursive: true, force: true });
      }
    },
  };
}

async function stageBackup(options: {
  archiveRoot: string;
  appConfig: AppConfig;
  configPath: string;
  selection: ScopeSelection;
}): Promise<BackupManifest> {
  const { archiveRoot, appConfig, configPath, selection } = options;
  await mkdir(archiveRoot, { recursive: true });

  const manifest: BackupManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    scopes: selectedScopes(selection),
    source: {
      configPath,
      dataRoot: appConfig.paths.dataRoot,
    },
  };

  if (selection.config) {
    const archivePath = "config/config.json";
    await copyFileIntoArchive(configPath, join(archiveRoot, archivePath));
    manifest.config = { archivePath };
  }

  if (selection.agents) {
    const agentFiles = collectAgentFiles(appConfig, configPath);
    manifest.agentFiles = [];

    for (const [index, entry] of agentFiles.entries()) {
      await assertAgentFileCanBeBackedUp(entry);
      const archivePath = `agents/${index.toString().padStart(3, "0")}-${sanitizeArchiveName(entry.agentId)}-${sanitizeArchiveName(entry.reference)}${getArchiveFileExtension(entry.sourcePath)}`;
      await copyFileIntoArchive(entry.sourcePath, join(archiveRoot, archivePath));
      manifest.agentFiles.push({
        ...entry,
        archivePath,
      });
    }
  }

  if (selection.conversations) {
    manifest.conversations = [];

    for (const bot of appConfig.bots) {
      const relativeToDataRoot = join("bots", bot.id, "conversations");
      const sourcePath = join(appConfig.paths.dataRoot, relativeToDataRoot);
      if (!(await pathExists(sourcePath))) {
        continue;
      }

      const archivePath = join("conversations", bot.id);
      await cp(sourcePath, join(archiveRoot, archivePath), { recursive: true });
      manifest.conversations.push({
        archivePath: toPortablePath(archivePath),
        botId: bot.id,
        relativeToDataRoot: toPortablePath(relativeToDataRoot),
      });
    }
  }

  return manifest;
}

function collectAgentFiles(appConfig: AppConfig, configPath: string): Omit<BackupAgentFileEntry, "archivePath">[] {
  const configDir = dirname(configPath);
  const files = new Map<string, Omit<BackupAgentFileEntry, "archivePath">>();

  for (const agent of appConfig.agents) {
    addAgentFile(files, {
      agentId: agent.id,
      reference: "prompt.base.file",
      configDir,
      configuredPath: agent.prompt.base.file,
    });

    for (const source of agent.prompt.instructions ?? []) {
      addAgentFile(files, {
        agentId: agent.id,
        reference: "prompt.instructions[].file",
        configDir,
        configuredPath: source.file,
      });
    }

    for (const source of agent.prompt.references ?? []) {
      addAgentFile(files, {
        agentId: agent.id,
        reference: "prompt.references[].file",
        configDir,
        configuredPath: source.file,
      });
    }

    addAgentFile(files, {
      agentId: agent.id,
      reference: "authFile",
      configDir,
      configuredPath: agent.authFile,
    });
  }

  return [...files.values()].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
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

async function assertAgentFileCanBeBackedUp(
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

async function restoreAgentFiles(options: {
  stageRoot: string;
  manifest: BackupManifest;
  targetConfigPath: string;
  targetDataRoot?: string;
  force: boolean;
}): Promise<void> {
  for (const entry of options.manifest.agentFiles ?? []) {
    const targetPath = relocateArchivedAgentFile(entry, options.manifest, {
      targetConfigPath: options.targetConfigPath,
      targetDataRoot: options.targetDataRoot,
    });
    const sourcePath = join(options.stageRoot, entry.archivePath);
    const content = await readFile(sourcePath, "utf8");

    await writeManagedFile({
      path: targetPath,
      resourceLabel: `Agent file (${entry.reference})`,
      content,
      force: options.force,
    });
  }
}

async function restoreConversationTrees(options: {
  stageRoot: string;
  manifest: BackupManifest;
  targetDataRoot: string;
  force: boolean;
}): Promise<void> {
  for (const entry of options.manifest.conversations ?? []) {
    const sourcePath = join(options.stageRoot, entry.archivePath);
    const targetPath = join(options.targetDataRoot, entry.relativeToDataRoot);

    await assertDirectoryCanBeRestored({
      path: targetPath,
      resourceLabel: `Conversation store for bot ${entry.botId}`,
      force: options.force,
    });

    if (options.force) {
      await rm(targetPath, { recursive: true, force: true });
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, { recursive: true });
  }
}

async function assertDirectoryCanBeRestored(options: {
  path: string;
  resourceLabel: string;
  force: boolean;
}): Promise<void> {
  if (!(await pathExists(options.path))) {
    return;
  }

  if (!options.force) {
    throw new Error(`${options.resourceLabel} already exists: ${resolve(options.path)}\nRe-run with --force to overwrite.`);
  }
}

async function resolveTargetConfigPath(options: {
  cliConfigPath?: string;
  selection: ScopeSelection;
  discoverConfigPath: typeof discoverConfigPath;
  getDefaultUserConfigPath: typeof getDefaultUserConfigPath;
}): Promise<string | undefined> {
  if (options.cliConfigPath) {
    return resolve(options.cliConfigPath);
  }

  if (!options.selection.config && !options.selection.agents && !options.selection.conversations) {
    return undefined;
  }

  try {
    const discovered = await options.discoverConfigPath();
    return discovered.configPath;
  } catch {
    if (options.selection.config) {
      return resolve(options.getDefaultUserConfigPath());
    }

    return undefined;
  }
}

function resolveTargetDataRoot(options: {
  cliDataRoot?: string;
  currentTargetConfig?: AppConfig;
  restoredConfig?: AppConfig;
  archiveConfig?: AppConfig;
  selection: ScopeSelection;
}): string | undefined {
  if (!options.selection.conversations) {
    return undefined;
  }

  if (options.cliDataRoot) {
    return resolve(options.cliDataRoot);
  }

  if (options.currentTargetConfig) {
    return resolve(options.currentTargetConfig.paths.dataRoot);
  }

  if (options.restoredConfig) {
    return resolve(options.restoredConfig.paths.dataRoot);
  }

  if (options.archiveConfig) {
    return resolve(options.archiveConfig.paths.dataRoot);
  }

  return undefined;
}

function applyConfigRestoreOverrides(
  appConfig: AppConfig,
  options: {
    dataRoot?: string;
    manifest: BackupManifest;
    targetConfigPath?: string;
  },
): AppConfig {
  const resolvedDataRoot = options.dataRoot ? resolve(options.dataRoot) : appConfig.paths.dataRoot;
  const relocatedConfig = relocateConfigFileReferences(appConfig, {
    manifest: {
      ...options.manifest,
      source: {
        ...options.manifest.source,
        dataRoot: appConfig.paths.dataRoot,
      },
    },
    targetConfigPath: options.targetConfigPath,
    targetDataRoot: resolvedDataRoot,
  });

  return {
    ...relocatedConfig,
    paths: {
      ...relocatedConfig.paths,
      dataRoot: resolvedDataRoot,
    },
  };
}

function relocateConfigFileReferences(
  appConfig: AppConfig,
  options: {
    manifest: BackupManifest;
    targetConfigPath?: string;
    targetDataRoot?: string;
  },
): AppConfig {
  const relocationMap = createAgentFileRelocationMap(options.manifest, {
    targetConfigPath: options.targetConfigPath,
    targetDataRoot: options.targetDataRoot,
  });
  if (relocationMap.size === 0) {
    return appConfig;
  }

  const sourceConfigDir = dirname(options.manifest.source.configPath);

  return {
    ...appConfig,
    agents: appConfig.agents.map((agent) => ({
      ...agent,
      authFile: relocateConfiguredFilePath(agent.authFile, sourceConfigDir, relocationMap),
      prompt: {
        ...agent.prompt,
        base: relocatePromptSource(agent.prompt.base, sourceConfigDir, relocationMap),
        instructions: agent.prompt.instructions?.map((source) =>
          relocatePromptSource(source, sourceConfigDir, relocationMap),
        ),
        references: agent.prompt.references?.map((source) =>
          relocatePromptSource(source, sourceConfigDir, relocationMap),
        ),
      },
    })),
  };
}

function relocatePromptSource(
  source: AppConfig["agents"][number]["prompt"]["base"],
  sourceConfigDir: string,
  relocationMap: ReadonlyMap<string, string>,
): AppConfig["agents"][number]["prompt"]["base"] {
  if (!source.file) {
    return source;
  }

  return {
    ...source,
    file: relocateConfiguredFilePath(source.file, sourceConfigDir, relocationMap) ?? source.file,
  };
}

function relocateConfiguredFilePath(
  configuredPath: string | undefined,
  sourceConfigDir: string,
  relocationMap: ReadonlyMap<string, string>,
): string | undefined {
  if (!configuredPath) {
    return undefined;
  }

  const resolvedSourcePath = resolveConfigPath(configuredPath, sourceConfigDir);
  const relocatedPath = relocationMap.get(resolvedSourcePath);
  if (!relocatedPath) {
    return configuredPath;
  }

  return isAbsolute(configuredPath) ? relocatedPath : configuredPath;
}

function createAgentFileRelocationMap(
  manifest: BackupManifest,
  options: {
    targetConfigPath?: string;
    targetDataRoot?: string;
  },
): Map<string, string> {
  const relocationMap = new Map<string, string>();

  for (const entry of manifest.agentFiles ?? []) {
    const relocatedPath = relocateArchivedAgentFile(entry, manifest, options);
    relocationMap.set(entry.sourcePath, relocatedPath);
  }

  return relocationMap;
}

function relocateArchivedAgentFile(
  entry: BackupAgentFileEntry,
  manifest: BackupManifest,
  options: {
    targetConfigPath?: string;
    targetDataRoot?: string;
  },
): string {
  if (entry.configRelativePath && options.targetConfigPath) {
    return resolve(dirname(options.targetConfigPath), entry.configRelativePath);
  }

  const sourceDataRootRelativePath = relativeIfContained(manifest.source.dataRoot, entry.sourcePath);
  if (sourceDataRootRelativePath && options.targetDataRoot) {
    return resolve(options.targetDataRoot, sourceDataRootRelativePath);
  }

  const sourceConfigDirRelativePath = relativeIfContained(dirname(manifest.source.configPath), entry.sourcePath);
  if (sourceConfigDirRelativePath && options.targetConfigPath) {
    return resolve(dirname(options.targetConfigPath), sourceConfigDirRelativePath);
  }

  return entry.sourcePath;
}

function relativeIfContained(rootPath: string, candidatePath: string): string | undefined {
  const relativePath = relative(resolve(rootPath), resolve(candidatePath));
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return undefined;
  }

  return relativePath;
}

async function readBackupManifest(stageRoot: string): Promise<BackupManifest> {
  const manifestPath = join(stageRoot, "manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<BackupManifest>;

  if (parsed.version !== 1 || !parsed.createdAt || !parsed.source?.configPath || !parsed.source?.dataRoot) {
    throw new Error("Invalid backup archive: malformed manifest.json");
  }

  return {
    version: 1,
    createdAt: parsed.createdAt,
    scopes: (parsed.scopes ?? []) as BackupScope[],
    source: parsed.source,
    ...(parsed.config ? { config: parsed.config } : {}),
    ...(parsed.agentFiles ? { agentFiles: parsed.agentFiles } : {}),
    ...(parsed.conversations ? { conversations: parsed.conversations } : {}),
  };
}

async function readArchivedConfig(stageRoot: string, manifest: BackupManifest): Promise<AppConfig> {
  if (!manifest.config) {
    throw new Error("Invalid backup archive: missing config entry");
  }

  const raw = await readFile(join(stageRoot, manifest.config.archivePath), "utf8");
  return JSON.parse(raw) as AppConfig;
}

function assertManifestContainsRequestedScopes(manifest: BackupManifest, selection: ScopeSelection): void {
  const available = new Set(manifest.scopes);

  for (const scope of selectedScopes(selection)) {
    if (!available.has(scope)) {
      throw new Error(`Backup archive does not contain requested scope: ${scope}`);
    }
  }
}

type ScopeSelection = Record<BackupScope, boolean>;

function parseScopeSelection(only: string | undefined): ScopeSelection {
  if (!only) {
    return {
      config: true,
      agents: true,
      conversations: true,
    };
  }

  const parsed = only
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (parsed.length === 0) {
    throw new Error("Expected --only to include at least one scope: config, agents, conversations");
  }

  const selection: ScopeSelection = {
    config: false,
    agents: false,
    conversations: false,
  };

  for (const scope of parsed) {
    if (scope !== "config" && scope !== "agents" && scope !== "conversations") {
      throw new Error(`Unsupported backup scope "${scope}". Expected: config, agents, conversations`);
    }

    selection[scope] = true;
  }

  return selection;
}

function selectedScopes(selection: ScopeSelection): BackupScope[] {
  return (["config", "agents", "conversations"] as const).filter((scope) => selection[scope]);
}

function selectedManifestScopes(manifest: BackupManifest, selection: ScopeSelection): BackupScope[] {
  const available = new Set(manifest.scopes);
  return selectedScopes(selection).filter((scope) => available.has(scope));
}

function resolveBackupOutputPath(outputPath: string | undefined, configPath: string): string {
  if (outputPath) {
    return resolve(outputPath);
  }

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return resolve(dirname(configPath), `imp-backup-${timestamp}.tar`);
}

function resolveConfigPath(path: string, configDir: string): string {
  return isAbsolute(path) ? path : resolve(configDir, path);
}

async function copyFileIntoArchive(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { force: true });
}

async function loadOptionalAppConfig(
  loadConfig: typeof loadAppConfig,
  configPath: string,
): Promise<AppConfig | undefined> {
  try {
    return await loadConfig(configPath);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid config file")) {
      throw error;
    }

    return undefined;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function sanitizeArchiveName(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]+/g, "-");
}

function getArchiveFileExtension(path: string): string {
  const fileName = path.split("/").pop() ?? path;
  const index = fileName.lastIndexOf(".");
  return index > 0 ? fileName.slice(index) : ".txt";
}

function toPortablePath(path: string): string {
  return path.replaceAll("\\", "/");
}

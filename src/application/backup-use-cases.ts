import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  assertBackupAgentFileIsReadable,
  type BackupAgentFileEntry,
  type BackupAgentHomeEntry,
  collectBackupAgentAssets,
  createBackupAgentAssetRelocator,
  shouldIncludeBackupAgentHome,
} from "./backup-agent-assets.js";
import { discoverConfigPath, getDefaultUserConfigPath } from "../config/discover-config-path.js";
import { loadAppConfig } from "../config/load-app-config.js";
import type { AppConfig } from "../config/types.js";
import { assertManagedFileCanBeWritten, writeManagedFile } from "../files/managed-file.js";
import { createTarArchive, extractTarArchive } from "../files/tar-archive.js";

export interface BackupUseCases {
  createBackup: (options: BackupCreateOptions) => Promise<void>;
  inspectBackup: (options: BackupInspectOptions) => Promise<void>;
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

export interface BackupInspectOptions {
  inputPath: string;
}

export type BackupScope = "config" | "agents" | "sessions" | "bindings";

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
  agentHomes?: BackupAgentHomeEntry[];
  sessions?: BackupDataRootTreeEntry[];
  bindings?: BackupDataRootTreeEntry[];
}

interface BackupDataRootTreeEntry {
  archivePath: string;
  endpointId: string;
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
    inspectBackup: async ({ inputPath }) => {
      const resolvedInputPath = resolve(inputPath);
      const stageRoot = await mkdtemp(join(tmpdir(), "imp-inspect-"));

      try {
        await extractTarArchive(resolvedInputPath, stageRoot);
        const manifest = await readBackupManifest(stageRoot);

        deps.writeOutput(renderBackupInspection(resolvedInputPath, manifest));
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
              "Agent restore requires either restoring config in the same command or pointing --config at an existing target config file.",
            );
          }

          await restoreAgentAssets({
            stageRoot,
            manifest,
            targetConfigPath,
            targetDataRoot,
            force,
          });
        }

        if (selection.sessions || selection.bindings) {
          if (!targetDataRoot) {
            throw new Error(
              "Session or binding restore requires --data-root, a restorable config in the backup, or an existing discovered config path.",
            );
          }
        }

        const resolvedTargetDataRoot = targetDataRoot!;
        if (selection.sessions) {
          await restoreDataRootTrees({
            stageRoot,
            entries: manifest.sessions ?? [],
            manifestProperty: "sessions",
            resourceLabel: "Session store",
            targetDataRoot: resolvedTargetDataRoot,
            force,
          });
        }

        if (selection.bindings) {
          await restoreDataRootTrees({
            stageRoot,
            entries: manifest.bindings ?? [],
            manifestProperty: "bindings",
            resourceLabel: "Binding store",
            targetDataRoot: resolvedTargetDataRoot,
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
    const agentAssets = collectBackupAgentAssets(appConfig, configPath);
    manifest.agentHomes = [];

    for (const entry of agentAssets.homes) {
      if (!(await shouldIncludeBackupAgentHome(entry))) {
        continue;
      }

      const archivePath = `agent-homes/${manifest.agentHomes.length.toString().padStart(3, "0")}-${sanitizeArchiveName(entry.agentId)}`;
      await copyDirectoryIntoArchive(entry.sourcePath, join(archiveRoot, archivePath));
      manifest.agentHomes.push({
        ...entry,
        archivePath,
      });
    }

    manifest.agentFiles = [];

    for (const [index, entry] of agentAssets.files.entries()) {
      await assertBackupAgentFileIsReadable(entry);
      const archivePath = `agents/${index.toString().padStart(3, "0")}-${sanitizeArchiveName(entry.agentId)}-${sanitizeArchiveName(entry.reference)}${getArchiveFileExtension(entry.sourcePath)}`;
      await copyFileIntoArchive(entry.sourcePath, join(archiveRoot, archivePath));
      manifest.agentFiles.push({
        ...entry,
        archivePath,
      });
    }
  }

  if (selection.sessions) {
    manifest.sessions = await stageDataRootTree(archiveRoot, appConfig.paths.dataRoot, "sessions");
  }

  if (selection.bindings) {
    manifest.bindings = await stageDataRootTree(archiveRoot, appConfig.paths.dataRoot, "bindings");
  }

  return manifest;
}

async function stageDataRootTree(
  archiveRoot: string,
  dataRoot: string,
  relativeToDataRoot: "sessions" | "bindings",
): Promise<BackupDataRootTreeEntry[]> {
  const sourcePath = join(dataRoot, relativeToDataRoot);
  if (!(await pathExists(sourcePath))) {
    return [];
  }

  const archivePath = relativeToDataRoot;
  await cp(sourcePath, join(archiveRoot, archivePath), { recursive: true });
  return [
    {
      archivePath,
      endpointId: "global",
      relativeToDataRoot,
    },
  ];
}

async function restoreAgentAssets(options: {
  stageRoot: string;
  manifest: BackupManifest;
  targetConfigPath: string;
  targetDataRoot?: string;
  force: boolean;
}): Promise<void> {
  const relocator = createBackupAgentAssetRelocator(options.manifest, {
    targetConfigPath: options.targetConfigPath,
    targetDataRoot: options.targetDataRoot,
  });

  for (const entry of options.manifest.agentHomes ?? []) {
    const targetPath = relocator.relocateArchivedHome(entry);
    const sourcePath = safeJoin(options.stageRoot, entry.archivePath, `manifest.agentHomes[].archivePath (${entry.agentId})`);

    await assertDirectoryCanBeRestored({
      path: targetPath,
      resourceLabel: `Agent home for agent ${entry.agentId}`,
      force: options.force,
    });

    if (options.force) {
      await rm(targetPath, { recursive: true, force: true });
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, { recursive: true });
  }

  for (const entry of options.manifest.agentFiles ?? []) {
    if (relocator.isFileContainedInArchivedHome(entry.sourcePath)) {
      continue;
    }

    const targetPath = relocator.relocateArchivedFile(entry);
    const sourcePath = safeJoin(options.stageRoot, entry.archivePath, `manifest.agentFiles[].archivePath (${entry.agentId})`);
    const content = await readFile(sourcePath, "utf8");

    await writeManagedFile({
      path: targetPath,
      resourceLabel: `Agent file (${entry.reference})`,
      content,
      force: options.force,
    });
  }
}

async function restoreDataRootTrees(options: {
  stageRoot: string;
  entries: BackupDataRootTreeEntry[];
  manifestProperty: "sessions" | "bindings";
  resourceLabel: string;
  targetDataRoot: string;
  force: boolean;
}): Promise<void> {
  for (const entry of options.entries) {
    const sourcePath = safeJoin(
      options.stageRoot,
      entry.archivePath,
      `manifest.${options.manifestProperty}[].archivePath (${entry.endpointId})`,
    );
    const targetPath = safeJoin(
      options.targetDataRoot,
      entry.relativeToDataRoot,
      `manifest.${options.manifestProperty}[].relativeToDataRoot (${entry.endpointId})`,
    );

    await assertDirectoryCanBeRestored({
      path: targetPath,
      resourceLabel: `${options.resourceLabel} ${entry.endpointId}`,
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

  if (!options.selection.config && !options.selection.agents && !options.selection.sessions && !options.selection.bindings) {
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
  if (!options.selection.agents && !options.selection.sessions && !options.selection.bindings) {
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
  const relocator = createBackupAgentAssetRelocator(options.manifest, {
    targetConfigPath: options.targetConfigPath,
    targetDataRoot: options.targetDataRoot,
  });

  const sourceConfigDir = dirname(options.manifest.source.configPath);

  return {
    ...appConfig,
    defaults: {
      ...appConfig.defaults,
      ...(appConfig.defaults.model
        ? {
            model: {
              ...appConfig.defaults.model,
              authFile: relocator.relocateConfiguredFilePath(appConfig.defaults.model.authFile, sourceConfigDir),
            },
          }
        : {}),
    },
    agents: appConfig.agents.map((agent) => ({
      ...agent,
      ...(agent.home
        ? {
            home: relocator.relocateConfiguredAgentHome(agent.home, sourceConfigDir),
          }
        : {}),
      ...(agent.model
        ? {
            model: {
              ...agent.model,
              authFile: relocator.relocateConfiguredFilePath(agent.model.authFile, sourceConfigDir),
            },
          }
        : {}),
      ...(agent.prompt
        ? {
            prompt: {
              ...agent.prompt,
              ...(agent.prompt.base
                ? { base: relocatePromptSource(agent.prompt.base, sourceConfigDir, relocator) }
                : {}),
              instructions: agent.prompt.instructions?.map((source) =>
                relocatePromptSource(source, sourceConfigDir, relocator),
              ),
              references: agent.prompt.references?.map((source) =>
                relocatePromptSource(source, sourceConfigDir, relocator),
              ),
            },
          }
        : {}),
    })),
  };
}

function relocatePromptSource(
  source: NonNullable<NonNullable<AppConfig["agents"][number]["prompt"]>["base"]>,
  sourceConfigDir: string,
  relocator: ReturnType<typeof createBackupAgentAssetRelocator>,
): NonNullable<NonNullable<AppConfig["agents"][number]["prompt"]>["base"]> {
  if (!source.file) {
    return source;
  }

  return {
    ...source,
    file: relocator.relocateConfiguredFilePath(source.file, sourceConfigDir) ?? source.file,
  };
}

async function readBackupManifest(stageRoot: string): Promise<BackupManifest> {
  const manifestPath = join(stageRoot, "manifest.json");
  const parsed = await readBackupJsonFile<Partial<BackupManifest>>(manifestPath, "manifest.json");

  if (parsed.version !== 1 || !parsed.createdAt || !parsed.source?.configPath || !parsed.source?.dataRoot) {
    throw new Error("Invalid backup archive: malformed manifest.json");
  }

  if (parsed.config) {
    assertSafeManifestRelativePath(parsed.config.archivePath, "manifest.config.archivePath");
  }

  for (const [index, entry] of (parsed.agentFiles ?? []).entries()) {
    assertSafeManifestRelativePath(entry.archivePath, `manifest.agentFiles[${index}].archivePath`);
    if (entry.configRelativePath) {
      assertSafeConfigRelativePath(entry.configRelativePath, `manifest.agentFiles[${index}].configRelativePath`);
    }
  }

  for (const [index, entry] of (parsed.agentHomes ?? []).entries()) {
    assertSafeManifestRelativePath(entry.archivePath, `manifest.agentHomes[${index}].archivePath`);
    if (entry.configRelativePath) {
      assertSafeConfigRelativePath(entry.configRelativePath, `manifest.agentHomes[${index}].configRelativePath`);
    }
  }

  for (const [index, entry] of (parsed.sessions ?? []).entries()) {
    assertSafeManifestRelativePath(entry.archivePath, `manifest.sessions[${index}].archivePath`);
    assertSafeManifestRelativePath(entry.relativeToDataRoot, `manifest.sessions[${index}].relativeToDataRoot`);
  }

  for (const [index, entry] of (parsed.bindings ?? []).entries()) {
    assertSafeManifestRelativePath(entry.archivePath, `manifest.bindings[${index}].archivePath`);
    assertSafeManifestRelativePath(entry.relativeToDataRoot, `manifest.bindings[${index}].relativeToDataRoot`);
  }

  return {
    version: 1,
    createdAt: parsed.createdAt,
    scopes: (parsed.scopes ?? []) as BackupScope[],
    source: parsed.source,
    ...(parsed.config ? { config: parsed.config } : {}),
    ...(parsed.agentFiles ? { agentFiles: parsed.agentFiles } : {}),
    ...(parsed.agentHomes ? { agentHomes: parsed.agentHomes } : {}),
    ...(parsed.sessions ? { sessions: parsed.sessions } : {}),
    ...(parsed.bindings ? { bindings: parsed.bindings } : {}),
  };
}

async function readArchivedConfig(stageRoot: string, manifest: BackupManifest): Promise<AppConfig> {
  if (!manifest.config) {
    throw new Error("Invalid backup archive: missing config entry");
  }

  return readBackupJsonFile<AppConfig>(
    safeJoin(stageRoot, manifest.config.archivePath, "manifest.config.archivePath"),
    manifest.config.archivePath,
  );
}

function assertPathInside(baseDir: string, candidatePath: string, label: string): void {
  const relativePath = relative(resolve(baseDir), resolve(candidatePath));
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Invalid backup archive: unsafe manifest path (${label})`);
  }
}

function safeJoin(baseDir: string, relativePath: string, label: string): string {
  assertSafeManifestRelativePath(relativePath, label);
  const resolved = resolve(baseDir, relativePath);
  assertPathInside(baseDir, resolved, label);
  return resolved;
}

function assertSafeManifestRelativePath(path: string, label: string): void {
  if (!path || path.includes("\0") || isAbsolute(path)) {
    throw new Error(`Invalid backup archive: unsafe manifest path (${label})`);
  }

  const portablePath = toPortablePath(path);
  const segments = portablePath.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || segment.length === 0)) {
    throw new Error(`Invalid backup archive: unsafe manifest path (${label})`);
  }

  const expectsFilePath =
    label === "manifest.config.archivePath" ||
    label.startsWith("manifest.agentFiles[") ||
    label.startsWith("manifest.agentHomes[") ||
    label.startsWith("manifest.sessions[") ||
    label.startsWith("manifest.bindings[");
  if (expectsFilePath && (portablePath.endsWith("/") || portablePath === ".")) {
    throw new Error(`Invalid backup archive: unsafe manifest path (${label})`);
  }
}

function assertSafeConfigRelativePath(path: string, label: string): void {
  if (!path || path.includes("\0") || isAbsolute(path)) {
    throw new Error(`Invalid backup archive: unsafe manifest path (${label})`);
  }

  const portablePath = toPortablePath(path);
  const segments = portablePath.split("/");
  const meaningfulSegments = segments[0] === "." ? segments.slice(1) : segments;
  if (
    meaningfulSegments.length === 0 ||
    meaningfulSegments.some((segment) => segment === ".." || segment === "." || segment.length === 0)
  ) {
    throw new Error(`Invalid backup archive: unsafe manifest path (${label})`);
  }
}

async function readBackupJsonFile<T>(path: string, archivePath: string): Promise<T> {
  const raw = await readFile(path, "utf8");

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid backup archive: invalid JSON in ${archivePath}`);
    }

    throw error;
  }
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
      sessions: true,
      bindings: true,
    };
  }

  const parsed = only
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (parsed.length === 0) {
    throw new Error("Expected --only to include at least one scope: config, agents, sessions, bindings");
  }

  const selection: ScopeSelection = {
    config: false,
    agents: false,
    sessions: false,
    bindings: false,
  };

  for (const scope of parsed) {
    if (scope !== "config" && scope !== "agents" && scope !== "sessions" && scope !== "bindings") {
      throw new Error(`Unsupported backup scope "${scope}". Expected: config, agents, sessions, bindings`);
    }

    selection[scope] = true;
  }

  return selection;
}

function selectedScopes(selection: ScopeSelection): BackupScope[] {
  return (["config", "agents", "sessions", "bindings"] as const).filter((scope) => selection[scope]);
}

function selectedManifestScopes(manifest: BackupManifest, selection: ScopeSelection): BackupScope[] {
  const available = new Set(manifest.scopes);
  return selectedScopes(selection).filter((scope) => available.has(scope));
}

function renderBackupInspection(inputPath: string, manifest: BackupManifest): string {
  const lines = [
    `Backup: ${inputPath}`,
    `Created: ${manifest.createdAt}`,
    `Scopes: ${formatList(manifest.scopes)}`,
    `Source config: ${manifest.source.configPath}`,
    `Source data root: ${manifest.source.dataRoot}`,
    "",
    `Config: ${manifest.config?.archivePath ?? "not included"}`,
    "",
    `Agent files: ${manifest.agentFiles?.length ?? 0}`,
  ];

  for (const entry of manifest.agentFiles ?? []) {
    lines.push(`- ${entry.agentId} ${entry.reference}: ${entry.sourcePath} -> ${entry.archivePath}`);
  }

  lines.push("");
  lines.push(`Agent homes: ${manifest.agentHomes?.length ?? 0}`);

  for (const entry of manifest.agentHomes ?? []) {
    lines.push(`- ${entry.agentId}: ${entry.sourcePath} -> ${entry.archivePath}`);
  }

  lines.push("");
  lines.push(`Sessions: ${manifest.sessions?.length ?? 0}`);

  for (const entry of manifest.sessions ?? []) {
    lines.push(`- ${entry.endpointId}: ${entry.relativeToDataRoot} -> ${entry.archivePath}`);
  }

  lines.push("");
  lines.push(`Bindings: ${manifest.bindings?.length ?? 0}`);

  for (const entry of manifest.bindings ?? []) {
    lines.push(`- ${entry.endpointId}: ${entry.relativeToDataRoot} -> ${entry.archivePath}`);
  }

  return lines.join("\n");
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function resolveBackupOutputPath(outputPath: string | undefined, configPath: string): string {
  if (outputPath) {
    return resolve(outputPath);
  }

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return resolve(dirname(configPath), `imp-backup-${timestamp}.tar`);
}

async function copyFileIntoArchive(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { force: true });
}

async function copyDirectoryIntoArchive(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { recursive: true });
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

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createDefaultAppConfig } from "./default-app-config.js";
import { getDefaultUserConfigPath } from "./discover-config-path.js";
import { assertManagedFileCanBeWritten, writeManagedFile } from "../files/managed-file.js";
import { appConfigSchema } from "./schema.js";
import type { AppConfig } from "./types.js";
import {
  createEmptyPromptTemplateContext,
  renderPromptTemplate,
  type PromptTemplateContext,
  type PromptTemplateSkillCatalogContext,
} from "../runtime/prompt-template.js";
import { resolveConfigPath as resolvePathRelativeToConfig } from "./secret-value.js";
import { loadAppConfig } from "./load-app-config.js";

const ownerReadWriteMode = 0o600;
const impSkillFileMode = 0o644;
const impSkillName = "imp-skill-creator";
const impSkillTemplate = readFileSync(
  new URL("../../assets/skills/imp-skill-creator/SKILL.md", import.meta.url),
  "utf8",
);

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
  const impSkillPath = resolveImpSkillPath(config, configPath);

  await assertManagedFileCanBeWritten({
    path: configPath,
    resourceLabel: "Config file",
    force: options.force,
  });
  await assertManagedFileCanBeWritten({
    path: impSkillPath,
    resourceLabel: "Imp skill",
    force: options.force,
  });

  const writtenConfigPath = await writeManagedFile({
    path: configPath,
    resourceLabel: "Config file",
    content: `${JSON.stringify(config, null, 2)}\n`,
    force: options.force,
    now: options.now,
    mode: ownerReadWriteMode,
  });

  await writeManagedFile({
    path: impSkillPath,
    resourceLabel: "Imp skill",
    content: renderImpSkillTemplate(config, configPath),
    force: options.force,
    now: options.now,
    mode: impSkillFileMode,
  });

  return writtenConfigPath;
}

export async function syncManagedSkills(options: {
  configPath: string;
  now?: Date;
}): Promise<string[]> {
  const configPath = resolve(options.configPath);
  const config = await loadAppConfig(configPath);
  const impSkillPath = resolveImpSkillPath(config, configPath);

  await writeManagedFile({
    path: impSkillPath,
    resourceLabel: "Imp skill",
    content: renderImpSkillTemplate(config, configPath),
    force: true,
    now: options.now,
    mode: impSkillFileMode,
  });

  return [impSkillPath];
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

function resolveImpSkillPath(config: AppConfig, configPath: string): string {
  const dataRoot = resolvePathRelativeToConfig(config.paths.dataRoot, dirname(configPath));
  return join(dataRoot, "skills", impSkillName, "SKILL.md");
}

function renderImpSkillTemplate(config: AppConfig, configPath: string): string {
  const dataRoot = resolvePathRelativeToConfig(config.paths.dataRoot, dirname(configPath));
  const context: PromptTemplateContext = {
    ...createEmptyPromptTemplateContext(),
    imp: {
      configPath,
      dataRoot,
      skillCatalogs: resolveSkillCatalogs(config, configPath),
      dynamicWorkspaceSkillsPath: "<working-directory>/.skills",
    },
  };

  return `${renderPromptTemplate(impSkillTemplate, {
    filePath: "built-in:imp-skill-creator",
    context,
  }).trim()}\n`;
}

function resolveSkillCatalogs(config: AppConfig, configPath: string): PromptTemplateSkillCatalogContext[] {
  const configDir = dirname(configPath);
  const dataRoot = resolvePathRelativeToConfig(config.paths.dataRoot, configDir);
  const catalogs: PromptTemplateSkillCatalogContext[] = [
    {
      label: "global shared catalog",
      path: join(dataRoot, "skills"),
    },
  ];

  for (const agent of config.agents) {
    if (agent.home) {
      catalogs.push({
        label: `agent-home catalog for ${agent.id}`,
        path: join(resolvePathRelativeToConfig(agent.home, configDir), ".skills"),
      });
    }

    for (const path of agent.skills?.paths ?? []) {
      catalogs.push({
        label: `configured shared catalog for ${agent.id}`,
        path: resolvePathRelativeToConfig(path, configDir),
      });
    }

    if (agent.workspace?.cwd) {
      catalogs.push({
        label: `workspace catalog for ${agent.id}`,
        path: join(resolvePathRelativeToConfig(agent.workspace.cwd, configDir), ".skills"),
      });
    }
  }

  return catalogs;
}

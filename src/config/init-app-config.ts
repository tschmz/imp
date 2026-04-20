import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createDefaultAppConfig } from "./default-app-config.js";
import { getDefaultUserConfigPath } from "./discover-config-path.js";
import { assertManagedFileCanBeWritten, writeManagedFile } from "../files/managed-file.js";
import { appConfigSchema } from "./schema.js";
import type { AppConfig } from "./types.js";
import { renderPromptTemplate, type PromptTemplateContext } from "../runtime/prompt-template.js";
import { resolveConfigPath as resolvePathRelativeToConfig } from "./secret-value.js";

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
    system: {
      os: "",
      platform: "",
      arch: "",
      hostname: "",
      username: "",
      homeDir: "",
    },
    runtime: {
      now: {
        iso: "",
        date: "",
        time: "",
        timeMinute: "",
        local: "",
        localMinute: "",
      },
      timezone: "",
    },
    endpoint: {
      id: "",
    },
    agent: {
      id: "",
      home: "",
      model: {
        provider: "",
        modelId: "",
      },
      workspace: {
        cwd: "",
      },
    },
    transport: {
      kind: "",
    },
    conversation: {
      kind: "",
      metadata: {},
    },
    reply: {
      channel: {
        kind: "",
        delivery: "none",
        endpointId: "",
      },
    },
    imp: {
      configPath,
      dataRoot,
    },
    skills: [],
  };

  return `${renderPromptTemplate(impSkillTemplate, {
    filePath: "built-in:imp-skill-creator",
    context,
  }).trim()}\n`;
}

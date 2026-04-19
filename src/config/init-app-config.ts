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
const impSkillTemplate = `---
name: imp-skill-creator
description: Create or update imp skills in imp-discovered skill catalogs. Use when the user wants to add, draft, revise, validate, or inspect an imp SKILL.md under paths.dataRoot/skills, agent.home/.skills, configured agents[].skills.paths, or workspace .skills.
---

# Imp Skill Creator

Use this skill when creating or updating skills for imp.

## Discovery Rules

- Put global skills under \`paths.dataRoot/skills/<skill-name>/SKILL.md\`.
- For this installation, \`paths.dataRoot\` is \`{{imp.dataRoot}}\`, so global skills live under \`{{imp.dataRoot}}/skills\`.
- Use workspace-local skills under \`<working-directory>/.skills/<skill-name>/SKILL.md\` when the skill should apply only to one workspace.
- Scan only one level deep: the skill root must be a direct child directory of the skill catalog root.
- Use lowercase skill names with digits and single hyphens only, no scopes or underscores.
- Keep the skill name at most 64 characters.
- Include YAML frontmatter with only \`name\` and \`description\` unless the codebase proves imp accepts more.
- Keep the description concise and trigger-oriented; imp exposes it in the skill catalog before \`load_skill\` loads the body.

## Drafting Workflow

1. Identify the target catalog root from the user's intent:
   - global shared skill: \`{{imp.dataRoot}}/skills\`
   - workspace skill: \`<working-directory>/.skills\`
   - configured shared catalog: the matching \`agents[].skills.paths\` entry
   - agent-home skill: \`<agent.home>/.skills\`
2. Create \`<catalog-root>/<skill-name>/SKILL.md\`.
3. Write a concise \`description\` that includes the action and the user requests that should trigger the skill.
4. Keep the body procedural and short. Put only instructions another agent needs at use time.
5. Add \`references/\` only for optional longer guidance that should be read on demand.
6. Add \`scripts/\` only when the workflow needs repeatable executable helpers.
7. Avoid \`README.md\`, changelogs, install notes, and placeholder files inside the skill.

## Validation

- Check that the skill is a direct child of the catalog root.
- Check that \`SKILL.md\` starts with valid YAML frontmatter:

\`\`\`markdown
---
name: example-skill
description: Do the thing. Use when the user asks for the thing.
---
\`\`\`

- Check that \`name\` matches \`^[a-z0-9]+(?:-[a-z0-9]+)*$\`.
- Check that \`description\` is not empty and is under 1024 characters.
- If this repo is available, compare assumptions against \`src/skills/discovery.ts\` before changing the format.

## Runtime Notes

- imp re-discovers auto-discovered skills on each user turn; edits under auto-discovered catalogs do not require a daemon restart.
- \`load_skill\` returns the selected \`SKILL.md\` body and lists bundled \`scripts/\` and \`references/\` files.
- \`load_skill\` does not read bundled resource contents automatically; mention in \`SKILL.md\` when a reference or script should be inspected or run.
- Catalog precedence is: \`paths.dataRoot/skills\`, \`agent.home/.skills\`, configured \`agents[].skills.paths\`, then \`<working-directory>/.skills\`. Later catalogs override earlier skills with the same name.
`;

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

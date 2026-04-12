import { arch, homedir, hostname, platform, type, userInfo } from "node:os";
import Handlebars from "handlebars";
import type { AgentDefinition } from "../domain/agent.js";
import type { SkillDefinition } from "../skills/types.js";

export interface PromptTemplateSystemContext {
  os: string;
  platform: string;
  arch: string;
  hostname: string;
  username: string;
  homeDir: string;
}

export interface PromptTemplateContext {
  system: PromptTemplateSystemContext;
  endpoint: {
    id: string;
  };
  agent: {
    id: string;
    model: {
      provider: string;
      modelId: string;
    };
    home: string;
    authFile?: string;
    workspace: {
      cwd?: string;
    };
  };
  transport: {
    kind: string;
  };
  imp: {
    configPath?: string;
    dataRoot?: string;
  };
  skills: PromptTemplateSkillContext[];
}

export interface PromptTemplateSkillContext {
  name: string;
  description: string;
  directoryPath: string;
  filePath: string;
}

export function createDefaultPromptTemplateSystemContext(): PromptTemplateSystemContext {
  return {
    os: type(),
    platform: platform(),
    arch: arch(),
    hostname: hostname(),
    username: resolveUsername(),
    homeDir: homedir(),
  };
}

export function createPromptTemplateContext(options: {
  system: PromptTemplateSystemContext;
  agent: AgentDefinition;
  endpointId: string;
  transportKind: string;
  configPath?: string;
  dataRoot?: string;
  availableSkills?: SkillDefinition[];
}): PromptTemplateContext {
  return {
    system: options.system,
    endpoint: {
      id: options.endpointId,
    },
    agent: {
      id: options.agent.id,
      model: {
        provider: options.agent.model.provider,
        modelId: options.agent.model.modelId,
      },
      home: options.agent.home ?? "",
      authFile: options.agent.authFile ?? "",
      workspace: {
        cwd: options.agent.workspace?.cwd ?? "",
      },
    },
    transport: {
      kind: options.transportKind,
    },
    imp: {
      configPath: options.configPath ?? "",
      dataRoot: options.dataRoot ?? "",
    },
    skills: (options.availableSkills ?? []).map((skill) => ({
      name: skill.name,
      description: skill.description,
      directoryPath: skill.directoryPath,
      filePath: skill.filePath,
    })),
  };
}

export function renderPromptTemplate(
  template: string,
  options: {
    filePath: string;
    context: PromptTemplateContext;
  },
): string {
  try {
    return promptHandlebars.compile(template, {
      knownHelpers: PROMPT_TEMPLATE_KNOWN_HELPERS,
      knownHelpersOnly: true,
      noEscape: true,
      strict: true,
    })(options.context);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to render prompt template ${options.filePath}: ${detail}`);
  }
}

const promptHandlebars = Handlebars.create();
const PROMPT_TEMPLATE_KNOWN_HELPERS = {
  each: true,
  if: true,
  instructionAttr: true,
  instructionText: true,
  unless: true,
  with: true,
};

promptHandlebars.registerHelper("instructionAttr", (value: unknown) =>
  escapeInstructionAttribute(String(value ?? "")),
);
promptHandlebars.registerHelper("instructionText", (value: unknown) =>
  escapeInstructionText(String(value ?? "")),
);

function escapeInstructionAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function escapeInstructionText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function resolveUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER ?? process.env.USERNAME ?? "";
  }
}

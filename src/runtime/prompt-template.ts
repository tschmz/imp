import { arch, homedir, hostname, platform, type, userInfo } from "node:os";
import type { AgentDefinition } from "../domain/agent.js";

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
  bot: {
    id: string;
  };
  agent: {
    id: string;
    model: {
      provider: string;
      modelId: string;
    };
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
  botId: string;
  transportKind: string;
  configPath?: string;
  dataRoot?: string;
}): PromptTemplateContext {
  return {
    system: options.system,
    bot: {
      id: options.botId,
    },
    agent: {
      id: options.agent.id,
      model: {
        provider: options.agent.model.provider,
        modelId: options.agent.model.modelId,
      },
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
  };
}

export function renderPromptTemplate(
  template: string,
  options: {
    filePath: string;
    context: PromptTemplateContext;
  },
): string {
  return template.replaceAll(TEMPLATE_PATTERN, (match, expression: string) => {
    if (!VALID_TEMPLATE_EXPRESSION_PATTERN.test(expression)) {
      throw new Error(
        `Unsupported prompt template expression in ${options.filePath}: ${match}. Only {{path.to.value}} is supported.`,
      );
    }

    const resolvedValue = resolveTemplateExpression(options.context, expression);
    if (resolvedValue === undefined) {
      throw new Error(
        `Unknown prompt template variable in ${options.filePath}: ${expression}. Available top-level roots: ${PROMPT_TEMPLATE_TOP_LEVEL_ROOTS.join(", ")}`,
      );
    }

    return resolvedValue;
  });
}

const TEMPLATE_PATTERN = /{{([^{}]+)}}/g;
const VALID_TEMPLATE_EXPRESSION_PATTERN = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/;
const PROMPT_TEMPLATE_TOP_LEVEL_ROOTS = ["system", "bot", "agent", "transport", "imp"] as const;

function resolveTemplateExpression(
  context: PromptTemplateContext,
  expression: string,
): string | undefined {
  const segments = expression.split(".");
  let current: unknown = context;

  for (const segment of segments) {
    if (typeof current !== "object" || current === null || !(segment in current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  if (current === undefined || current === null) {
    return undefined;
  }

  if (typeof current === "object") {
    return undefined;
  }

  return String(current);
}

function resolveUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER ?? process.env.USERNAME ?? "";
  }
}

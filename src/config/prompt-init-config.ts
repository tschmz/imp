import { confirm, input, select } from "@inquirer/prompts";
import { join } from "node:path";
import { getDefaultAgentSystemPromptFilePath } from "../agents/default-system-prompt.js";
import {
  buildInitialAppConfig,
  createDefaultAppConfig,
  getSuggestedModelId,
  parseCommaSeparatedValues,
  parsePathEntries,
  validateTelegramUserIds,
} from "./default-app-config.js";
import type { AppConfig } from "./types.js";

interface PromptDependencies {
  confirm: typeof confirm;
  input: typeof input;
  select: typeof select;
}

export interface InitialAppSetup {
  config: AppConfig;
  installService: boolean;
  serviceEnvironment?: Record<string, string>;
}

const providerChoices = [
  { name: "OpenAI", value: "openai" },
  { name: "Anthropic", value: "anthropic" },
  { name: "OpenAI Codex", value: "openai-codex" },
  { name: "GitHub Copilot", value: "github-copilot" },
  { name: "Google Gemini CLI", value: "google-gemini-cli" },
  { name: "Google Antigravity", value: "google-antigravity" },
  { name: "Other provider", value: "other" },
] as const;

export async function promptForInitialAppConfig(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: PromptDependencies = { confirm, input, select },
): Promise<InitialAppSetup> {
  const defaults = createDefaultAppConfig(env);
  const defaultAgent = defaults.agents[0];
  const defaultBot = defaults.bots[0];

  if (!defaultAgent || !defaultAgent.model || !defaultBot) {
    throw new Error("Default init config is incomplete.");
  }

  const instanceName = await dependencies.input({
    message: "Instance name",
    default: defaults.instance.name,
    validate: requireNonEmpty("Instance name is required."),
  });

  const dataRoot = await dependencies.input({
    message: "Data root for logs and runtime state",
    default: defaults.paths.dataRoot,
    validate: requireNonEmpty("Data root is required."),
  });

  const providerSelection = await dependencies.select({
    message: "Default agent provider",
    choices: providerChoices,
    default: "openai",
  });

  const provider =
    providerSelection === "other"
      ? await dependencies.input({
          message: "Provider ID",
          validate: requireNonEmpty("Provider ID is required."),
        })
      : providerSelection;

  const modelId = await dependencies.input({
    message: "Model ID",
    default: getSuggestedModelId(provider),
    validate: requireNonEmpty("Model ID is required."),
  });

  const telegramToken = await dependencies.input({
    message: "Telegram bot token",
    default: defaultBot.token,
    validate: requireNonEmpty("Telegram bot token is required."),
  });

  const allowedUserIdsRaw = await dependencies.input({
    message: "Allowed Telegram user IDs (comma-separated, optional)",
    default: "",
    validate: validateTelegramUserIds,
  });

  const workingDirectory = await dependencies.input({
    message: "Agent working directory (optional)",
    default: "",
  });

  const includeAgentsFile =
    workingDirectory.length > 0
      ? await dependencies.confirm({
          message: "Add AGENTS.md from the working directory?",
          default: true,
        })
      : false;

  const extraContextFilesRaw = await dependencies.input({
    message: "Additional context files (comma-separated, optional)",
    default: "",
  });

  const shellPathRaw = await dependencies.input({
    message: "Shell PATH for bash tool (colon-separated, optional)",
    default: "",
  });

  const installService =
    process.platform === "win32"
      ? false
      : await dependencies.confirm({
          message: "Install and start imp as a background service now?",
          default: true,
        });

  const serviceEnvironment =
    installService && process.platform === "linux"
      ? await promptForServiceEnvironment(provider, env, dependencies)
      : undefined;

  return {
    config: buildInitialAppConfig(env, {
      instanceName,
      dataRoot,
      provider,
      modelId,
      telegramToken,
      allowedUserIds: parseCommaSeparatedValues(allowedUserIdsRaw),
      ...(workingDirectory.length > 0 ? { workingDirectory } : {}),
      contextFiles: [
        ...(includeAgentsFile ? [join(workingDirectory, "AGENTS.md")] : []),
        ...parseCommaSeparatedValues(extraContextFilesRaw),
      ],
      shellPath: parsePathEntries(shellPathRaw),
      systemPromptFile: getDefaultAgentSystemPromptFilePath(dataRoot),
    }),
    installService,
    ...(serviceEnvironment ? { serviceEnvironment } : {}),
  };
}

async function promptForServiceEnvironment(
  provider: string,
  env: NodeJS.ProcessEnv,
  dependencies: PromptDependencies,
): Promise<Record<string, string> | undefined> {
  const providerVariables = getProviderEnvironmentVariables(provider);
  const values = new Map<string, string>();

  for (const variableName of providerVariables) {
    const existingValue = env[variableName]?.trim();
    const variableValue = await dependencies.input({
      message: `Service environment value for ${variableName}`,
      default: existingValue ?? "",
      validate: requireNonEmpty(`${variableName} is required to run the ${provider} provider as a service.`),
    });
    values.set(variableName, variableValue.trim());
  }

  const extraVariablesRaw = await dependencies.input({
    message: "Additional service environment variables (KEY=value, comma-separated, optional)",
    default: "",
    validate: validateServiceEnvironmentVariables,
  });

  for (const [name, value] of parseServiceEnvironmentVariables(extraVariablesRaw)) {
    values.set(name, value);
  }

  if (values.size === 0) {
    return undefined;
  }

  return Object.fromEntries(values);
}

function requireNonEmpty(message: string): (value: string) => true | string {
  return (value) => {
    if (value.trim().length > 0) {
      return true;
    }

    return message;
  };
}

export function getProviderEnvironmentVariables(provider: string): string[] {
  switch (provider) {
    case "anthropic":
      return ["ANTHROPIC_API_KEY"];
    case "azure-openai-responses":
      return ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_BASE_URL"];
    case "cerebras":
      return ["CEREBRAS_API_KEY"];
    case "google":
      return ["GEMINI_API_KEY"];
    case "groq":
      return ["GROQ_API_KEY"];
    case "huggingface":
      return ["HF_TOKEN"];
    case "kimi-coding":
      return ["KIMI_API_KEY"];
    case "minimax":
      return ["MINIMAX_API_KEY"];
    case "minimax-cn":
      return ["MINIMAX_CN_API_KEY"];
    case "mistral":
      return ["MISTRAL_API_KEY"];
    case "openai":
      return ["OPENAI_API_KEY"];
    case "opencode":
    case "opencode-go":
      return ["OPENCODE_API_KEY"];
    case "openrouter":
      return ["OPENROUTER_API_KEY"];
    case "vercel-ai-gateway":
      return ["AI_GATEWAY_API_KEY"];
    case "xai":
      return ["XAI_API_KEY"];
    case "zai":
      return ["ZAI_API_KEY"];
    default:
      return [];
  }
}

function validateServiceEnvironmentVariables(raw: string): true | string {
  try {
    parseServiceEnvironmentVariables(raw);
    return true;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid service environment variables.";
  }
}

function parseServiceEnvironmentVariables(raw: string): Array<[string, string]> {
  const values = parseCommaSeparatedValues(raw);

  return values.map((entry) => {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error("Use KEY=value entries for additional service environment variables.");
    }

    const name = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();

    if (!/^[A-Z_][A-Z0-9_]*$/i.test(name)) {
      throw new Error(`Invalid environment variable name: ${name}`);
    }

    if (value.length === 0) {
      throw new Error(`Environment variable ${name} requires a value.`);
    }

    return [name, value];
  });
}

import { confirm, input, select } from "@inquirer/prompts";
import { join } from "node:path";
import {
  buildInitialAppConfig,
  createDefaultAppConfig,
  getSuggestedModelId,
  parseCommaSeparatedValues,
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

  const useSystemPromptFile = await dependencies.confirm({
    message: "Use a system prompt file?",
    default: false,
  });

  const systemPromptFile = useSystemPromptFile
    ? await dependencies.input({
        message: "System prompt file path",
        default: join(dataRoot, "SYSTEM.md"),
        validate: requireNonEmpty("System prompt file path is required."),
      })
    : undefined;

  const installService =
    process.platform === "win32"
      ? false
      : await dependencies.confirm({
          message: "Install and start imp as a background service now?",
          default: true,
        });

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
      ...(systemPromptFile ? { systemPromptFile } : {}),
    }),
    installService,
  };
}

function requireNonEmpty(message: string): (value: string) => true | string {
  return (value) => {
    if (value.trim().length > 0) {
      return true;
    }

    return message;
  };
}

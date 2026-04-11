import { getOAuthProvider } from "@mariozechner/pi-ai/oauth";
import { getDefaultAgentSystemPromptFilePath } from "../agents/default-system-prompt.js";
import { join } from "node:path";
import { getDefaultUserDataRoot } from "./discover-config-path.js";
import type { AppConfig } from "./types.js";

const defaultAgentId = "default";
const defaultBotId = "private-telegram";
const defaultTools = ["read", "bash", "edit", "write", "grep", "find", "ls"];

export interface InitialConfigAnswers {
  instanceName: string;
  dataRoot: string;
  provider: string;
  modelId: string;
  telegramToken: string;
  allowedUserIds: string[];
  workingDirectory?: string;
  instructionFiles?: string[];
  referenceFiles?: string[];
  shellPath?: string[];
  promptBaseFile?: string;
}

export function createDefaultAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  const dataRoot = getDefaultUserDataRoot(env);

  return buildInitialAppConfig(env, {
    instanceName: "default",
    dataRoot,
    provider: "openai",
    modelId: "gpt-5.4",
    telegramToken: "replace-me",
    allowedUserIds: [],
    promptBaseFile: getDefaultAgentSystemPromptFilePath(dataRoot),
  });
}

export function buildInitialAppConfig(
  _env: NodeJS.ProcessEnv,
  answers: InitialConfigAnswers,
): AppConfig {
  const prompt = buildAgentPrompt(answers);
  const workspace = buildAgentWorkspace(answers);
  const usesOAuth = Boolean(getOAuthProvider(answers.provider));

  return {
    instance: {
      name: answers.instanceName,
    },
    paths: {
      dataRoot: answers.dataRoot,
    },
    logging: {
      level: "info",
    },
    defaults: {
      agentId: defaultAgentId,
    },
    agents: [
      {
        id: defaultAgentId,
        model: {
          provider: answers.provider,
          modelId: answers.modelId,
        },
        prompt,
        ...(usesOAuth ? { authFile: join(answers.dataRoot, "auth.json") } : {}),
        tools: [...defaultTools],
        ...(workspace ? { workspace } : {}),
        skills: {
          paths: [],
        },
        inference: {
          metadata: {
            app: "imp",
          },
          request: {
            store: true,
          },
        },
      },
    ],
    bots: [
      {
        id: defaultBotId,
        type: "telegram",
        enabled: true,
        token: answers.telegramToken,
        access: {
          allowedUserIds: answers.allowedUserIds,
        },
      },
    ],
  };
}

export function getSuggestedModelId(provider: string): string {
  switch (provider) {
    case "anthropic":
      return "claude-sonnet-4-5";
    case "openai":
    case "openai-codex":
      return "gpt-5.4";
    case "google-gemini-cli":
    case "google-antigravity":
      return "gemini-2.5-pro";
    case "github-copilot":
      return "gpt-5.4";
    default:
      return "replace-me";
  }
}

export function parseCommaSeparatedValues(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function parsePathEntries(raw: string): string[] {
  return raw
    .split(":")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function validateTelegramUserIds(raw: string): true | string {
  const values = parseCommaSeparatedValues(raw);
  if (values.every((value) => /^\d+$/.test(value))) {
    return true;
  }

  return "Telegram user IDs must contain digits only.";
}

function buildAgentPrompt(answers: InitialConfigAnswers): AppConfig["agents"][number]["prompt"] {
  const instructionFiles = answers.instructionFiles?.filter((value) => value.length > 0) ?? [];
  const referenceFiles = answers.referenceFiles?.filter((value) => value.length > 0) ?? [];

  return {
    base: {
      file: answers.promptBaseFile ?? getDefaultAgentSystemPromptFilePath(answers.dataRoot),
    },
    ...(instructionFiles.length > 0
      ? {
          instructions: instructionFiles.map((file) => ({ file })),
        }
      : {}),
    ...(referenceFiles.length > 0
      ? {
          references: referenceFiles.map((file) => ({ file })),
        }
      : {}),
  };
}

function buildAgentWorkspace(
  answers: InitialConfigAnswers,
): AppConfig["agents"][number]["workspace"] | undefined {
  const shellPath = answers.shellPath?.filter((value) => value.length > 0) ?? [];
  if (!answers.workingDirectory && shellPath.length === 0) {
    return undefined;
  }

  return {
    ...(answers.workingDirectory ? { cwd: answers.workingDirectory } : {}),
    ...(shellPath.length > 0 ? { shellPath } : {}),
  };
}

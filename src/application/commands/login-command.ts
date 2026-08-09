import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { loginModelProvider } from "../../runtime/login-model-provider.js";
import { isOAuthProvider } from "../../runtime/pi-ai-runtime.js";
import type { AgentDefinition } from "../../domain/agent.js";
import type { OutgoingMessage } from "../../domain/message.js";
import type { InboundCommandContext, InboundCommandHandler } from "./types.js";
import { normalizeCommandArgument } from "./utils.js";

export interface ModelProviderLoginRequest {
  provider: string;
  authFile: string;
  notify(event: AuthEvent): Promise<void> | void;
  prompt(prompt: AuthPrompt): Promise<string>;
}

export type ModelProviderLogin = (request: ModelProviderLoginRequest) => Promise<void>;

export const loginCommandHandler: InboundCommandHandler = {
  metadata: {
    name: "login",
    description: "Log in to the model provider",
    usage: "/login [provider]",
    helpDescription: "Log in to the selected agent's OAuth model provider, or to the named provider",
    helpGroup: "Diagnostics",
  },
  canHandle(command) {
    return command === "login";
  },
  async handle(context: InboundCommandContext) {
    const { message, dependencies } = context;
    const agent = await resolveCommandAgent(context);
    const provider = normalizeCommandArgument(message.commandArgs) ?? agent.model.provider;
    const authFile = agent.model.authFile;

    if (!isOAuthProvider(provider)) {
      return commandResponse(message.conversation, `**Login**\nProvider \`${provider}\` does not support OAuth login.`);
    }

    if (!authFile) {
      return commandResponse(
        message.conversation,
        [
          "**Login**",
          `Provider \`${provider}\` needs an \`authFile\` in the selected agent's model config before remote login can store credentials.`,
        ].join("\n"),
      );
    }

    let sentProgress = false;
    let progressDelivery = Promise.resolve();
    const deliverProgress = context.deliverProgress;
    const notify = (event: AuthEvent) => {
      const rendered = renderAuthEvent(provider, event);
      sentProgress = true;
      if (deliverProgress) {
        progressDelivery = progressDelivery.then(() => deliverProgress(commandResponse(message.conversation, rendered)));
      }
    };

    try {
      await (dependencies.loginModelProvider ?? loginModelProvider)({
        provider,
        authFile,
        notify,
        prompt: selectNonInteractiveLoginOption,
      });
      await progressDelivery;
    } catch (error) {
      await progressDelivery.catch(() => undefined);
      const detail = error instanceof Error ? error.message : String(error);
      return commandResponse(
        message.conversation,
        [
          "**Login failed**",
          detail,
        ].join("\n"),
      );
    }

    return commandResponse(
      message.conversation,
      [
        "**Login complete**",
        `Credentials for \`${provider}\` were saved.`,
        ...(sentProgress && !deliverProgress ? ["Login instructions were emitted by the provider, but this transport does not support progress delivery."] : []),
      ].join("\n"),
    );
  },
};

async function resolveCommandAgent(context: InboundCommandContext): Promise<AgentDefinition> {
  const selectedAgentId =
    await context.dependencies.conversationStore.getSelectedAgent?.(context.message.conversation) ??
    context.dependencies.defaultAgentId;
  const agent = context.dependencies.agentRegistry.get(selectedAgentId);
  if (agent) {
    return agent;
  }

  const defaultAgent = context.dependencies.agentRegistry.get(context.dependencies.defaultAgentId);
  if (!defaultAgent) {
    throw new Error(`Unknown default agent: ${context.dependencies.defaultAgentId}`);
  }
  return defaultAgent;
}

function commandResponse(conversation: OutgoingMessage["conversation"], text: string): OutgoingMessage {
  return { conversation, text };
}

function renderAuthEvent(provider: string, event: AuthEvent): string {
  switch (event.type) {
    case "auth_url":
      return [
        "**Login required**",
        `Provider: \`${provider}\``,
        "Open this URL:",
        event.url,
        ...(event.instructions ? [event.instructions] : []),
      ].join("\n");
    case "device_code":
      return [
        "**Login required**",
        `Provider: \`${provider}\``,
        "Open this URL:",
        event.verificationUri,
        `Code: \`${event.userCode}\``,
        ...(event.expiresInSeconds ? [`Expires in ${event.expiresInSeconds} seconds.`] : []),
      ].join("\n");
    case "info":
    case "progress":
      return ["**Login**", event.message].join("\n");
  }
}

async function selectNonInteractiveLoginOption(prompt: AuthPrompt): Promise<string> {
  if (prompt.type !== "select") {
    throw new Error(`Provider login requires an interactive ${prompt.type} prompt, which is not supported remotely.`);
  }

  const deviceCodeOption = prompt.options.find((option) =>
    option.id.toLowerCase().includes("device") || option.label.toLowerCase().includes("device"),
  );
  const option = deviceCodeOption ?? (prompt.options.length === 1 ? prompt.options[0] : undefined);
  if (!option) {
    throw new Error("Provider login requires choosing a login method, but no non-interactive option is available.");
  }

  return option.id;
}

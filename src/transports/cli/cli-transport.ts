import { randomUUID } from "node:crypto";
import {
  CombinedAutocompleteProvider,
  Container,
  Editor,
  Key,
  Loader,
  Markdown,
  ProcessTerminal,
  Spacer,
  Text,
  TruncatedText,
  TUI,
  matchesKey,
  truncateToWidth,
  type EditorTheme,
  type MarkdownTheme,
} from "@mariozechner/pi-tui";
import { parseInboundCommand } from "../../application/commands/parse-inbound-command.js";
import { inboundCommandMenu, inboundCommandNames } from "../../application/commands/registry.js";
import { renderUserFacingError } from "../../application/render-user-facing-error.js";
import type { ActiveEndpointRuntimeConfig, CliEndpointRuntimeConfig } from "../../daemon/types.js";
import type { IncomingMessageCommand, OutgoingMessageAttachment, OutgoingMessageReplayItem } from "../../domain/message.js";
import type { Logger } from "../../logging/types.js";
import type { Transport, TransportHandler, TransportInboundEvent } from "../types.js";
import {
  createCliPromptHistoryStore,
  type CliPromptHistoryStore,
} from "./prompt-history.js";

type CliTransportRuntimeConfig = CliEndpointRuntimeConfig & Pick<ActiveEndpointRuntimeConfig, "defaultAgentId" | "paths">;

const identity = (text: string) => text;
const sgr = (code: number) => (text: string) => `\x1b[${code}m${text}\x1b[0m`;
const bold = sgr(1);
const dim = sgr(2);
const cyan = sgr(36);
const green = sgr(32);
const red = sgr(31);

const editorTheme: EditorTheme = {
  borderColor: identity,
  selectList: {
    selectedPrefix: identity,
    selectedText: identity,
    description: identity,
    scrollInfo: identity,
    noMatch: identity,
  },
};

const markdownTheme: MarkdownTheme = {
  heading: identity,
  link: identity,
  linkUrl: identity,
  code: identity,
  codeBlock: identity,
  codeBlockBorder: identity,
  quote: identity,
  quoteBorder: identity,
  hr: identity,
  listBullet: identity,
  bold: identity,
  italic: identity,
  strikethrough: identity,
  underline: identity,
};

export function createCliTransport(
  config: CliTransportRuntimeConfig,
  logger?: Logger,
): Transport {
  let ui: TUI | undefined;
  let resolveStopped: (() => void) | undefined;
  let stopInputListener: (() => void) | undefined;
  let stopped = false;

  const stop = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    stopInputListener?.();
    stopInputListener = undefined;
    ui?.stop();
    ui = undefined;
    resolveStopped?.();
    resolveStopped = undefined;
  };

  return {
    async start(handler: TransportHandler): Promise<void> {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error("The CLI endpoint requires an interactive terminal.");
      }

      stopped = false;
      const terminalUi = new TUI(new ProcessTerminal(), true);
      ui = terminalUi;
      let activeAgentId = config.initialAgentId ?? config.defaultAgentId;

      const chatContainer = new Container();
      const statusContainer = new Container();
      const processingStatus = createCliProcessingStatus(statusContainer, terminalUi);
      const promptHistory = createCliPromptHistoryStore(config.paths.dataRoot);
      const editor = new Editor(terminalUi, editorTheme, {
        paddingX: 1,
        autocompleteMaxVisible: 8,
      });
      editor.setAutocompleteProvider(createCliAutocompleteProvider());
      await loadCliPromptHistoryIntoEditor(editor, promptHistory, activeAgentId, logger);

      terminalUi.addChild(new TruncatedText(bold(`imp chat: ${config.id}`), 0, 0));
      terminalUi.addChild(
        new Text(
          dim("Type /help for commands, Tab for file paths, Shift+Enter for a new line, /quit to exit."),
          0,
          0,
        ),
      );
      terminalUi.addChild(new Spacer(1));
      terminalUi.addChild(chatContainer);
      terminalUi.addChild(statusContainer);
      terminalUi.addChild(editor);
      terminalUi.setFocus(editor);
      renderCliReplay(config.initialReplay ?? [], chatContainer);

      stopInputListener = terminalUi.addInputListener((data) => {
        if (!matchesKey(data, Key.ctrl("c"))) {
          return undefined;
        }

        stop();
        return { consume: true };
      });

      editor.onSubmit = (text) => {
        void submitInput(text, {
          config,
          editor,
          chatContainer,
          processingStatus,
          promptHistory,
          getActiveAgentId: () => activeAgentId,
          setActiveAgentId: (agentId) => {
            activeAgentId = agentId;
          },
          ui: terminalUi,
          handler,
          logger,
          stop,
        });
      };

      terminalUi.start();
      terminalUi.requestRender(true);

      await new Promise<void>((resolve) => {
        resolveStopped = resolve;
      });
    },
    stop,
  };
}

async function submitInput(
  rawText: string,
  options: {
    config: CliEndpointRuntimeConfig;
    editor: Editor;
    chatContainer: Container;
    processingStatus: CliProcessingStatus;
    promptHistory: CliPromptHistoryStore;
    getActiveAgentId: () => string;
    setActiveAgentId: (agentId: string) => void;
    ui: TUI;
    handler: TransportHandler;
    logger?: Logger;
    stop: () => void;
  },
): Promise<void> {
  const text = rawText.trim();
  if (!text) {
    return;
  }

  if (text === "/quit" || text === "/exit") {
    options.editor.setText("");
    options.stop();
    return;
  }

  options.editor.addToHistory(text);
  persistCliPromptHistory(options.promptHistory, options.getActiveAgentId(), text, options.logger);
  options.editor.setText("");
  options.chatContainer.addChild(new Text(green("You"), 0, 0));
  options.chatContainer.addChild(new Text(text, 1, 0));
  options.chatContainer.addChild(new Spacer(1));
  options.ui.requestRender();

  const event = createCliInboundEvent(options.config, text, {
    chatContainer: options.chatContainer,
    processingStatus: options.processingStatus,
    onAgentResolved: options.setActiveAgentId,
    ui: options.ui,
    logger: options.logger,
  });

  detachCliEventProcessing(options.handler.handle(event), {
    logger: options.logger,
    endpointId: options.config.id,
    conversationId: options.config.userId,
    messageId: event.message.messageId,
    correlationId: event.message.correlationId,
  });
}

function createCliInboundEvent(
  config: CliEndpointRuntimeConfig,
  text: string,
  options: {
    chatContainer: Container;
    processingStatus: CliProcessingStatus;
    onAgentResolved: (agentId: string) => void;
    ui: TUI;
    logger?: Logger;
  },
): TransportInboundEvent {
  const correlationId = randomUUID();
  const messageId = randomUUID();
  const parsedCommand = parseInboundCommand(text, {
    allowedCommands: inboundCommandNames,
  });

  return {
    message: {
      endpointId: config.id,
      conversation: {
        endpointId: config.id,
        transport: "cli",
        externalId: config.userId,
      },
      messageId,
      correlationId,
      userId: config.userId,
      text,
      receivedAt: new Date().toISOString(),
      source: {
        kind: "text",
      },
      ...(parsedCommand ? toIncomingCommand(parsedCommand) : {}),
    },
    async runWithProcessing<T>(operation: () => Promise<T>): Promise<T> {
      const loaderId = options.processingStatus.start(formatProcessingMessage(text));

      try {
        return await operation();
      } finally {
        options.processingStatus.stop(loaderId);
      }
    },
    async deliver(message): Promise<void> {
      if (message.conversation.agentId) {
        options.onAgentResolved(message.conversation.agentId);
      }
      options.chatContainer.addChild(new Text(cyan("imp"), 0, 0));
      if (message.text.length > 0) {
        options.chatContainer.addChild(new Markdown(message.text, 1, 0, markdownTheme));
      }
      renderCliAttachments(message.attachments ?? [], options.chatContainer);
      options.chatContainer.addChild(new Spacer(1));
      renderCliReplay(message.replay ?? [], options.chatContainer);
      options.ui.requestRender();
    },
    async deliverProgress(message): Promise<void> {
      options.chatContainer.addChild(new Text(cyan("imp"), 0, 0));
      options.chatContainer.addChild(new Markdown(message.text, 1, 0, markdownTheme));
      options.chatContainer.addChild(new Spacer(1));
      options.ui.requestRender();
    },
    async deliverError(error): Promise<void> {
      await options.logger?.debug("sending cli processing error response", {
        endpointId: config.id,
        transport: "cli",
        conversationId: config.userId,
        messageId,
        correlationId,
        errorType: error instanceof Error ? error.name : typeof error,
      });
      options.chatContainer.addChild(new Text(red("Error"), 0, 0));
      options.chatContainer.addChild(new Text(renderUserFacingError(error), 1, 0));
      options.chatContainer.addChild(new Spacer(1));
      options.ui.requestRender();
    },
  };
}

function renderCliAttachments(
  attachments: OutgoingMessageAttachment[],
  chatContainer: Container,
): void {
  if (attachments.length === 0) {
    return;
  }

  chatContainer.addChild(new Text(dim("Attachments:"), 1, 0));
  for (const attachment of attachments) {
    const label = attachment.fileName ? `${attachment.fileName}: ${attachment.path}` : attachment.path;
    chatContainer.addChild(new Text(dim(`- ${label}`), 1, 0));
  }
}

async function loadCliPromptHistoryIntoEditor(
  editor: Editor,
  promptHistory: CliPromptHistoryStore,
  agentId: string,
  logger: Logger | undefined,
): Promise<void> {
  try {
    const entries = await promptHistory.read(agentId);

    for (const entry of [...entries].reverse()) {
      editor.addToHistory(entry);
    }
  } catch (error) {
    await logger?.debug("failed to load cli prompt history", {
      agentId,
      errorType: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

function persistCliPromptHistory(
  promptHistory: CliPromptHistoryStore,
  agentId: string,
  text: string,
  logger: Logger | undefined,
): void {
  void promptHistory.add(agentId, text).catch((error: unknown) => {
    void logger?.debug("failed to persist cli prompt history", {
      agentId,
      errorType: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  });
}

interface CliProcessingStatus {
  start(label: string): string;
  stop(id: string): void;
}

function createCliProcessingStatus(statusContainer: Container, ui: TUI): CliProcessingStatus {
  const loaders = new Map<string, Loader>();

  function render(): void {
    statusContainer.clear();
    for (const loader of loaders.values()) {
      statusContainer.addChild(loader);
    }
    ui.requestRender();
  }

  return {
    start(label) {
      const id = randomUUID();
      loaders.set(id, new Loader(ui, cyan, dim, label));
      render();
      return id;
    },
    stop(id) {
      const loader = loaders.get(id);
      if (!loader) {
        return;
      }

      loader.stop();
      loaders.delete(id);
      render();
    },
  };
}

function detachCliEventProcessing(
  operation: Promise<void>,
  options: {
    logger?: Logger;
    endpointId: string;
    conversationId: string;
    messageId: string;
    correlationId: string;
  },
): void {
  void Promise.resolve()
    .then(() => operation)
    .catch((error) => {
      void logCliTerminalFailure(
        options.logger,
        {
          endpointId: options.endpointId,
          conversationId: options.conversationId,
          messageId: options.messageId,
          correlationId: options.correlationId,
          errorType: error instanceof Error ? error.name : typeof error,
        },
        error,
      ).catch(() => {
        // Detached processing must never leak terminal failure logging errors.
      });
    });
}

async function logCliTerminalFailure(
  logger: Logger | undefined,
  fields: {
    endpointId: string;
    conversationId: string;
    messageId: string;
    correlationId: string;
    errorType: string;
  },
  error: unknown,
): Promise<void> {
  await logger?.error(
    "cli message processing terminated after an unhandled failure",
    {
      endpointId: fields.endpointId,
      transport: "cli",
      conversationId: fields.conversationId,
      messageId: fields.messageId,
      correlationId: fields.correlationId,
      errorType: fields.errorType,
    },
    error,
  );
}

function renderCliReplay(
  replay: OutgoingMessageReplayItem[],
  chatContainer: Container,
): void {
  for (const item of replay) {
    if (item.role === "user") {
      chatContainer.addChild(new Text(green("You"), 0, 0));
      chatContainer.addChild(new Text(item.text, 1, 0));
    } else {
      chatContainer.addChild(new Text(cyan("imp"), 0, 0));
      chatContainer.addChild(new Markdown(item.text, 1, 0, markdownTheme));
    }
    chatContainer.addChild(new Spacer(1));
  }
}

function createCliAutocompleteProvider(): CombinedAutocompleteProvider {
  return new CombinedAutocompleteProvider(
    inboundCommandMenu.map((entry) => ({
      name: entry.command,
      description: entry.description,
    })),
    process.cwd(),
  );
}

function formatProcessingMessage(text: string): string {
  return `Working on ${truncateToWidth(text.replace(/\s+/g, " "), 72)}`;
}

function toIncomingCommand(
  parsedCommand: {
    command: IncomingMessageCommand;
    commandArgs?: string;
  },
): { command: IncomingMessageCommand; commandArgs?: string } {
  return {
    command: parsedCommand.command,
    ...(parsedCommand.commandArgs ? { commandArgs: parsedCommand.commandArgs } : {}),
  };
}

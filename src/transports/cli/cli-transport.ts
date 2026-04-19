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
import type { CliEndpointRuntimeConfig } from "../../daemon/types.js";
import type { IncomingMessageCommand } from "../../domain/message.js";
import type { OutgoingMessageReplayItem } from "../../domain/message.js";
import type { Logger } from "../../logging/types.js";
import type { Transport, TransportHandler, TransportInboundEvent } from "../types.js";

const identity = (text: string) => text;
const sgr = (code: number) => (text: string) => `\x1b[${code}m${text}\x1b[0m`;
const bold = sgr(1);
const dim = sgr(2);
const cyan = sgr(36);
const green = sgr(32);
const yellow = sgr(33);
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
  config: CliEndpointRuntimeConfig,
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

      const chatContainer = new Container();
      const statusContainer = new Container();
      const editor = new Editor(terminalUi, editorTheme, {
        paddingX: 1,
        autocompleteMaxVisible: 8,
      });
      editor.setAutocompleteProvider(createCliAutocompleteProvider());

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
          statusContainer,
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
    statusContainer: Container;
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
  options.editor.setText("");
  options.editor.disableSubmit = true;
  options.editor.borderColor = yellow;
  options.chatContainer.addChild(new Text(green("You"), 0, 0));
  options.chatContainer.addChild(new Text(text, 1, 0));
  options.chatContainer.addChild(new Spacer(1));
  options.ui.requestRender();

  const event = createCliInboundEvent(options.config, text, {
    chatContainer: options.chatContainer,
    statusContainer: options.statusContainer,
    ui: options.ui,
    logger: options.logger,
  });

  try {
    await options.handler.handle(event);
  } catch (error) {
    await options.logger?.error(
      "cli message processing terminated after an unhandled failure",
      {
        endpointId: options.config.id,
        transport: "cli",
        conversationId: options.config.userId,
        messageId: event.message.messageId,
        correlationId: event.message.correlationId,
        errorType: error instanceof Error ? error.name : typeof error,
      },
      error,
    );
    await event.deliverError?.(error);
  } finally {
    options.editor.disableSubmit = false;
    options.editor.borderColor = identity;
    options.ui.requestRender();
  }
}

function createCliInboundEvent(
  config: CliEndpointRuntimeConfig,
  text: string,
  options: {
    chatContainer: Container;
    statusContainer: Container;
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
      const loader = new Loader(options.ui, cyan, dim, formatProcessingMessage(text));
      options.statusContainer.clear();
      options.statusContainer.addChild(loader);
      options.ui.requestRender();

      try {
        return await operation();
      } finally {
        loader.stop();
        options.statusContainer.clear();
        options.ui.requestRender();
      }
    },
    async deliver(message): Promise<void> {
      options.chatContainer.addChild(new Text(cyan("imp"), 0, 0));
      options.chatContainer.addChild(new Markdown(message.text, 1, 0, markdownTheme));
      options.chatContainer.addChild(new Spacer(1));
      renderCliReplay(message.replay ?? [], options.chatContainer);
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
      options.chatContainer.addChild(new Text("Sorry, something went wrong while processing your message.", 1, 0));
      options.chatContainer.addChild(new Spacer(1));
      options.ui.requestRender();
    },
  };
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

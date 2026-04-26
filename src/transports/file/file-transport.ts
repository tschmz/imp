import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ActiveEndpointRuntimeConfig, FileEndpointRuntimeConfig } from "../../daemon/types.js";
import type { IncomingMessage } from "../../domain/message.js";
import type { Logger } from "../../logging/types.js";
import {
  pluginErrorRecordSchema,
  pluginEventSchema,
  pluginOutboxMessageSchema,
  type PluginEvent,
} from "../../plugins/protocol.js";
import type { Transport, TransportContext, TransportHandler, TransportInboundEvent } from "../types.js";

type FileTransportRuntimeConfig = FileEndpointRuntimeConfig & ActiveEndpointRuntimeConfig;
type FileOutboxRuntimeConfig = FileTransportRuntimeConfig & {
  response: Extract<FileTransportRuntimeConfig["response"], { type: "outbox" }>;
};

interface PluginEventFile {
  originalPath: string;
  processingPath: string;
  finalName: string;
  bytes: number;
}

interface PendingPluginEventFile {
  fileName: string;
  originalPath: string;
  processingPath: string;
  finalName: string;
}

export function createFileTransport(
  config: FileTransportRuntimeConfig,
  logger: Logger,
  context: TransportContext,
): Transport {
  if (!config.paths.file) {
    throw new Error(`File endpoint "${config.id}" is missing file runtime paths.`);
  }

  const paths = config.paths.file;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let activeScan: Promise<void> = Promise.resolve();

  return {
    async start(handler: TransportHandler): Promise<void> {
      await ensurePluginDirectories(config);
      await logger.info("file endpoint runtime directories", {
        endpointId: config.id,
        pluginId: config.pluginId,
        rootDir: paths.rootDir,
        inboxDir: paths.inboxDir,
        processingDir: paths.processingDir,
        processedDir: paths.processedDir,
        failedDir: paths.failedDir,
        outboxDir: paths.outboxDir,
      });

      const scan = () => {
        if (stopped) {
          return;
        }

        activeScan = activeScan
          .catch(() => undefined)
          .then(async () => {
            if (stopped) {
              return;
            }

            await scanPluginInbox(config, handler, context, logger);
          });
      };

      scan();
      await activeScan.catch(() => undefined);
      if (stopped) {
        return;
      }

      timer = setInterval(scan, config.ingress.pollIntervalMs);

      await new Promise<void>((resolve) => {
        const checkStopped = () => {
          if (stopped) {
            resolve();
            return;
          }

          setTimeout(checkStopped, config.ingress.pollIntervalMs);
        };
        checkStopped();
      });
    },
    async stop(): Promise<void> {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      await activeScan.catch(() => undefined);
    },
  };
}

async function ensurePluginDirectories(config: FileTransportRuntimeConfig): Promise<void> {
  const paths = getPluginPaths(config);
  await mkdir(paths.rootDir, { recursive: true });
  await mkdir(paths.inboxDir, { recursive: true });
  await mkdir(paths.processingDir, { recursive: true });
  await mkdir(paths.processedDir, { recursive: true });
  await mkdir(paths.failedDir, { recursive: true });
  await mkdir(paths.outboxDir, { recursive: true });
}

async function scanPluginInbox(
  config: FileTransportRuntimeConfig,
  handler: TransportHandler,
  context: TransportContext,
  logger: Logger,
): Promise<void> {
  const paths = getPluginPaths(config);
  const fileNames = await listPluginEventFiles(paths.inboxDir);

  for (const fileName of fileNames) {
    await processPluginEventFile(config, handler, context, logger, fileName);
  }
}

async function listPluginEventFiles(inboxDir: string): Promise<string[]> {
  const entries = await readdir(inboxDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
}

async function processPluginEventFile(
  config: FileTransportRuntimeConfig,
  handler: TransportHandler,
  context: TransportContext,
  logger: Logger,
  fileName: string,
): Promise<void> {
  const pendingFile = createPendingPluginEventFile(config, fileName);

  try {
    const eventFile = await claimPluginEventFile(config, pendingFile);
    const event = await readPluginEvent(eventFile);
    await handlePluginEventFile(config, handler, context, logger, pendingFile.fileName, eventFile, event);
    await moveProcessedEvent(config, eventFile);
  } catch (error) {
    await recordFailedEvent(config, logger, {
      originalPath: pendingFile.originalPath,
      processingPath: pendingFile.processingPath,
      finalName: pendingFile.finalName,
      fileName: pendingFile.fileName,
      error,
    });
  }
}

function createPendingPluginEventFile(
  config: FileTransportRuntimeConfig,
  fileName: string,
): PendingPluginEventFile {
  const paths = getPluginPaths(config);
  const originalPath = join(paths.inboxDir, fileName);
  const processingPath = join(paths.processingDir, `${Date.now()}-${randomUUID()}-${sanitizeFileName(fileName)}`);

  return {
    fileName,
    originalPath,
    processingPath,
    finalName: basename(processingPath),
  };
}

async function claimPluginEventFile(
  config: FileTransportRuntimeConfig,
  pendingFile: PendingPluginEventFile,
): Promise<PluginEventFile> {
  const fileStat = await stat(pendingFile.originalPath);
  if (fileStat.size > config.ingress.maxEventBytes) {
    throw new PluginEventFileError(
      `Plugin event file "${pendingFile.fileName}" exceeds configured size limit (${fileStat.size} > ${config.ingress.maxEventBytes}).`,
    );
  }

  await rename(pendingFile.originalPath, pendingFile.processingPath);
  return {
    originalPath: pendingFile.originalPath,
    processingPath: pendingFile.processingPath,
    finalName: pendingFile.finalName,
    bytes: fileStat.size,
  };
}

async function readPluginEvent(eventFile: PluginEventFile): Promise<PluginEvent> {
  const raw = await readFile(eventFile.processingPath, "utf8");
  const parsed = pluginEventSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new PluginEventFileError(parsed.error.message);
  }

  return parsed.data;
}

async function handlePluginEventFile(
  config: FileTransportRuntimeConfig,
  handler: TransportHandler,
  context: TransportContext,
  logger: Logger,
  fileName: string,
  eventFile: PluginEventFile,
  event: PluginEvent,
): Promise<void> {
  const inboundEvent = createPluginInboundEvent(config, context, eventFile, event);
  await logger.debug("received plugin event file", {
    endpointId: config.id,
    pluginId: config.pluginId,
    fileName,
    messageId: inboundEvent.message.messageId,
    correlationId: inboundEvent.message.correlationId,
  });
  await handler.handle(inboundEvent);
}

function createPluginInboundEvent(
  config: FileTransportRuntimeConfig,
  context: TransportContext,
  eventFile: PluginEventFile,
  event: PluginEvent,
): TransportInboundEvent {
  const eventId = event.id ?? basename(eventFile.finalName, ".json");
  const conversationId = event.conversationId ?? config.pluginId;
  const userId = event.userId ?? config.pluginId;
  const correlationId = event.correlationId ?? randomUUID();

  const message: IncomingMessage = {
    endpointId: config.id,
    conversation: {
      transport: "file",
      externalId: conversationId,
      ...(event.session ? { sessionId: event.session.id } : {}),
    },
    messageId: eventId,
    correlationId,
    userId,
    text: event.text,
    receivedAt: event.receivedAt ?? new Date().toISOString(),
    source: {
      kind: "plugin-event",
      plugin: {
        pluginId: config.pluginId,
        eventId,
        fileName: basename(eventFile.originalPath),
        ...((event.metadata || event.session || event.response)
          ? {
              metadata: {
                ...(event.metadata ?? {}),
                ...(event.session
                  ? {
                      session: event.session,
                    }
                  : {}),
                ...(event.response ? { response: event.response } : {}),
              },
            }
          : {}),
      },
    },
  };

  return {
    message,
    async runWithProcessing<T>(operation: () => Promise<T>): Promise<T> {
      return operation();
    },
    async deliver(response): Promise<void> {
      await deliverPluginResponse(config, context, message, response.text, event.response);
    },
  };
}

async function deliverPluginResponse(
  config: FileTransportRuntimeConfig,
  context: TransportContext,
  inbound: IncomingMessage,
  text: string,
  eventResponse: PluginEvent["response"] | undefined,
): Promise<void> {
  if (eventResponse?.type === "none") {
    return;
  }

  switch (config.response.type) {
    case "none":
      return;
    case "outbox":
      await writePluginOutboxMessage(config as FileOutboxRuntimeConfig, inbound, text);
      return;
    case "endpoint": {
      const responseTransport =
        context.endpointTransportById?.get(config.response.endpointId) ??
        "endpoint";
      await context.deliveryRouter.deliver({
        endpointId: config.response.endpointId,
        target: config.response.target,
        message: {
          conversation: {
            transport: responseTransport,
            externalId: config.response.target.conversationId,
          },
          text,
        },
      });
      return;
    }
  }
}

async function writePluginOutboxMessage(
  config: FileOutboxRuntimeConfig,
  inbound: IncomingMessage,
  text: string,
): Promise<void> {
  const paths = getPluginPaths(config);
  const fileName = `${Date.now()}-${sanitizeFileName(inbound.messageId)}-${randomUUID()}.json`;
  const message = pluginOutboxMessageSchema.parse({
    schemaVersion: 1,
    id: randomUUID(),
    eventId: inbound.messageId,
    correlationId: inbound.correlationId,
    conversationId: inbound.conversation.externalId,
    userId: inbound.userId,
    replyChannel: config.response.replyChannel,
    priority: config.response.priority ?? "normal",
    ...(config.response.ttlMs ? { ttlMs: config.response.ttlMs } : {}),
    ...(config.response.speech ? { speech: config.response.speech } : {}),
    text,
    createdAt: new Date().toISOString(),
  });
  await writeFile(
    join(paths.outboxDir, fileName),
    `${JSON.stringify(message, null, 2)}\n`,
    "utf8",
  );
}

async function moveProcessedEvent(
  config: FileTransportRuntimeConfig,
  eventFile: PluginEventFile,
): Promise<void> {
  const paths = getPluginPaths(config);
  await rename(eventFile.processingPath, join(paths.processedDir, eventFile.finalName));
}

async function recordFailedEvent(
  config: FileTransportRuntimeConfig,
  logger: Logger,
  input: {
    originalPath: string;
    processingPath: string;
    finalName: string;
    fileName: string;
    error: unknown;
  },
): Promise<void> {
  const paths = getPluginPaths(config);
  const failedPath = join(paths.failedDir, input.finalName);
  const sourcePath = await pathExists(input.processingPath) ? input.processingPath : input.originalPath;

  if (await pathExists(sourcePath)) {
    await rename(sourcePath, failedPath);
  }

  const errorRecordPath = `${failedPath}.error.json`;
  const errorRecord = pluginErrorRecordSchema.parse({
    fileName: input.fileName,
    endpointId: config.id,
    pluginId: config.pluginId,
    failedAt: new Date().toISOString(),
    errorType: input.error instanceof Error ? input.error.name : typeof input.error,
    message: input.error instanceof Error ? input.error.message : String(input.error),
  });
  await writeFile(
    errorRecordPath,
    `${JSON.stringify(errorRecord, null, 2)}\n`,
    "utf8",
  );

  await logger.error(
    "failed to process plugin event file",
    {
      endpointId: config.id,
      pluginId: config.pluginId,
      fileName: input.fileName,
      failedPath,
      errorRecordPath,
      errorType: input.error instanceof Error ? input.error.name : typeof input.error,
    },
    input.error,
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function getPluginPaths(config: FileTransportRuntimeConfig): NonNullable<FileTransportRuntimeConfig["paths"]["file"]> {
  if (!config.paths.file) {
    throw new Error(`File endpoint "${config.id}" is missing file runtime paths.`);
  }

  return config.paths.file;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_") || "event.json";
}

class PluginEventFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginEventFileError";
  }
}

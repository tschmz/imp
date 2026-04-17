import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import type { ActiveEndpointRuntimeConfig, PluginEndpointRuntimeConfig } from "../../daemon/types.js";
import type { IncomingMessage } from "../../domain/message.js";
import type { Logger } from "../../logging/types.js";
import type { Transport, TransportContext, TransportHandler, TransportInboundEvent } from "../types.js";

type PluginTransportRuntimeConfig = PluginEndpointRuntimeConfig & ActiveEndpointRuntimeConfig;

const pluginEventSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  id: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  text: z.string().min(1),
  receivedAt: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

interface PluginEventFile {
  originalPath: string;
  processingPath: string;
  finalName: string;
  bytes: number;
}

export function createPluginTransport(
  config: PluginTransportRuntimeConfig,
  logger: Logger,
  context: TransportContext,
): Transport {
  if (!config.paths.plugin) {
    throw new Error(`Plugin endpoint "${config.id}" is missing plugin runtime paths.`);
  }

  const paths = config.paths.plugin;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let activeScan: Promise<void> = Promise.resolve();

  return {
    async start(handler: TransportHandler): Promise<void> {
      await ensurePluginDirectories(config);
      await logger.info("plugin endpoint runtime directories", {
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

async function ensurePluginDirectories(config: PluginTransportRuntimeConfig): Promise<void> {
  const paths = getPluginPaths(config);
  await mkdir(paths.rootDir, { recursive: true });
  await mkdir(paths.inboxDir, { recursive: true });
  await mkdir(paths.processingDir, { recursive: true });
  await mkdir(paths.processedDir, { recursive: true });
  await mkdir(paths.failedDir, { recursive: true });
  await mkdir(paths.outboxDir, { recursive: true });
}

async function scanPluginInbox(
  config: PluginTransportRuntimeConfig,
  handler: TransportHandler,
  context: TransportContext,
  logger: Logger,
): Promise<void> {
  const paths = getPluginPaths(config);
  const entries = await readdir(paths.inboxDir, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  for (const fileName of fileNames) {
    await processPluginEventFile(config, handler, context, logger, fileName);
  }
}

async function processPluginEventFile(
  config: PluginTransportRuntimeConfig,
  handler: TransportHandler,
  context: TransportContext,
  logger: Logger,
  fileName: string,
): Promise<void> {
  const paths = getPluginPaths(config);
  const originalPath = join(paths.inboxDir, fileName);
  const processingPath = join(paths.processingDir, `${Date.now()}-${randomUUID()}-${sanitizeFileName(fileName)}`);
  const finalName = basename(processingPath);

  try {
    const fileStat = await stat(originalPath);
    if (fileStat.size > config.ingress.maxEventBytes) {
      throw new PluginEventFileError(
        `Plugin event file "${fileName}" exceeds configured size limit (${fileStat.size} > ${config.ingress.maxEventBytes}).`,
      );
    }

    await rename(originalPath, processingPath);
    const eventFile = {
      originalPath,
      processingPath,
      finalName,
      bytes: fileStat.size,
    };
    const raw = await readFile(processingPath, "utf8");
    const parsed = pluginEventSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new PluginEventFileError(parsed.error.message);
    }

    const inboundEvent = createPluginInboundEvent(config, context, eventFile, parsed.data);
    await logger.debug("received plugin event file", {
      endpointId: config.id,
      pluginId: config.pluginId,
      fileName,
      messageId: inboundEvent.message.messageId,
      correlationId: inboundEvent.message.correlationId,
    });
    await handler.handle(inboundEvent);
    await moveProcessedEvent(config, eventFile);
  } catch (error) {
    await recordFailedEvent(config, logger, {
      originalPath,
      processingPath,
      finalName,
      fileName,
      error,
    });
  }
}

function createPluginInboundEvent(
  config: PluginTransportRuntimeConfig,
  context: TransportContext,
  eventFile: PluginEventFile,
  event: z.infer<typeof pluginEventSchema>,
): TransportInboundEvent {
  const eventId = event.id ?? basename(eventFile.finalName, ".json");
  const conversationId = event.conversationId ?? config.pluginId;
  const userId = event.userId ?? config.pluginId;
  const correlationId = event.correlationId ?? randomUUID();

  const message: IncomingMessage = {
    endpointId: config.id,
    conversation: {
      transport: "plugin",
      externalId: conversationId,
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
        ...(event.metadata ? { metadata: event.metadata } : {}),
      },
    },
  };

  return {
    message,
    async runWithProcessing<T>(operation: () => Promise<T>): Promise<T> {
      return operation();
    },
    async deliver(response): Promise<void> {
      switch (config.response.type) {
        case "none":
          return;
        case "outbox":
          await writePluginOutboxMessage(config, message, response.text);
          return;
        case "endpoint":
          await context.deliveryRouter.deliver({
            endpointId: config.response.endpointId,
            target: config.response.target,
            message: {
              conversation: {
                transport: config.response.endpointId,
                externalId: config.response.target.conversationId,
              },
              text: response.text,
            },
          });
          return;
      }
    },
  };
}

async function writePluginOutboxMessage(
  config: PluginTransportRuntimeConfig,
  inbound: IncomingMessage,
  text: string,
): Promise<void> {
  const paths = getPluginPaths(config);
  const fileName = `${Date.now()}-${sanitizeFileName(inbound.messageId)}-${randomUUID()}.json`;
  await writeFile(
    join(paths.outboxDir, fileName),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: randomUUID(),
        eventId: inbound.messageId,
        correlationId: inbound.correlationId,
        conversationId: inbound.conversation.externalId,
        userId: inbound.userId,
        text,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function moveProcessedEvent(
  config: PluginTransportRuntimeConfig,
  eventFile: PluginEventFile,
): Promise<void> {
  const paths = getPluginPaths(config);
  await rename(eventFile.processingPath, join(paths.processedDir, eventFile.finalName));
}

async function recordFailedEvent(
  config: PluginTransportRuntimeConfig,
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
  await writeFile(
    errorRecordPath,
    `${JSON.stringify(
      {
        fileName: input.fileName,
        endpointId: config.id,
        pluginId: config.pluginId,
        failedAt: new Date().toISOString(),
        errorType: input.error instanceof Error ? input.error.name : typeof input.error,
        message: input.error instanceof Error ? input.error.message : String(input.error),
      },
      null,
      2,
    )}\n`,
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

function getPluginPaths(config: PluginTransportRuntimeConfig): NonNullable<PluginTransportRuntimeConfig["paths"]["plugin"]> {
  if (!config.paths.plugin) {
    throw new Error(`Plugin endpoint "${config.id}" is missing plugin runtime paths.`);
  }

  return config.paths.plugin;
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

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveEndpointRuntimeConfig, PluginEndpointRuntimeConfig } from "../../daemon/types.js";
import type { Logger } from "../../logging/types.js";
import { createDeliveryRouter } from "../delivery-router.js";
import { createPluginTransport } from "./plugin-transport.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("createPluginTransport", () => {
  it("ingests plugin event files and writes routed replies to the plugin outbox", async () => {
    const root = await createTempDir();
    const config = createPluginRuntimeConfig(root, {
      response: {
        type: "outbox",
        replyChannel: {
          kind: "audio",
        },
        priority: "high",
        ttlMs: 30000,
        speech: {
          enabled: true,
          language: "en",
          model: "gpt-4o-mini-tts",
          voice: "ash",
          instructions: "Use short spoken replies.",
        },
      },
    });
    const logger = createMockLogger();
    const transport = createPluginTransport(config, logger, {
      deliveryRouter: createDeliveryRouter(),
    });
    await ensurePluginDirs(config);

    await writeFile(
      join(config.paths.plugin!.inboxDir, "wake.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        id: "wake-1",
        conversationId: "kitchen",
        userId: "frontend",
        text: "turn on the lights",
        metadata: {
          confidence: 0.94,
        },
      })}\n`,
      "utf8",
    );

    const start = transport.start({
      handle: vi.fn(async (event) => {
        expect(event.message).toMatchObject({
          endpointId: "audio-ingress",
          conversation: {
            transport: "plugin",
            externalId: "kitchen",
          },
          messageId: "wake-1",
          userId: "frontend",
          text: "turn on the lights",
          source: {
            kind: "plugin-event",
            plugin: {
              pluginId: "pi-audio",
              eventId: "wake-1",
              fileName: "wake.json",
              metadata: {
                confidence: 0.94,
              },
            },
          },
        });
        await event.deliver({
          conversation: event.message.conversation,
          text: "lights are on",
        });
      }),
    });

    await waitForDirectoryEntry(config.paths.plugin!.processedDir, ".json");
    const outboxFile = await waitForDirectoryEntry(config.paths.plugin!.outboxDir, ".json");
    const outbox = JSON.parse(await readFile(join(config.paths.plugin!.outboxDir, outboxFile), "utf8"));

    expect(outbox).toMatchObject({
      schemaVersion: 1,
      eventId: "wake-1",
      conversationId: "kitchen",
      userId: "frontend",
      replyChannel: {
        kind: "audio",
      },
      priority: "high",
      ttlMs: 30000,
      speech: {
        enabled: true,
        language: "en",
        model: "gpt-4o-mini-tts",
        voice: "ash",
        instructions: "Use short spoken replies.",
      },
      text: "lights are on",
    });
    expect(await readdir(config.paths.plugin!.failedDir)).toEqual([]);

    await transport.stop?.();
    await start;
  });

  it("routes plugin replies to configured endpoint delivery targets", async () => {
    const root = await createTempDir();
    const deliveryRouter = createDeliveryRouter();
    const delivered = vi.fn(async () => {});
    deliveryRouter.register("private-telegram", {
      deliver: delivered,
    });
    const config = createPluginRuntimeConfig(root, {
      response: {
        type: "endpoint",
        endpointId: "private-telegram",
        target: {
          conversationId: "123456789",
        },
      },
    });
    const transport = createPluginTransport(config, createMockLogger(), {
      deliveryRouter,
    });
    await ensurePluginDirs(config);

    await writeFile(
      join(config.paths.plugin!.inboxDir, "event.json"),
      `${JSON.stringify({
        id: "event-1",
        text: "hello",
      })}\n`,
      "utf8",
    );

    const start = transport.start({
      handle: vi.fn(async (event) => {
        await event.deliver({
          conversation: event.message.conversation,
          text: "agent reply",
        });
      }),
    });

    await waitForDirectoryEntry(config.paths.plugin!.processedDir, ".json");

    expect(delivered).toHaveBeenCalledWith({
      endpointId: "private-telegram",
      target: {
        conversationId: "123456789",
      },
      message: {
        conversation: {
          transport: "private-telegram",
          externalId: "123456789",
        },
        text: "agent reply",
      },
    });

    await transport.stop?.();
    await start;
  });

  it("records invalid plugin event files in the failed directory", async () => {
    const root = await createTempDir();
    const config = createPluginRuntimeConfig(root, {
      response: {
        type: "none",
      },
    });
    const transport = createPluginTransport(config, createMockLogger(), {
      deliveryRouter: createDeliveryRouter(),
    });
    await ensurePluginDirs(config);

    await writeFile(join(config.paths.plugin!.inboxDir, "bad.json"), "{\"text\":\"\"}\n", "utf8");

    const start = transport.start({
      handle: vi.fn(async () => {
        throw new Error("should not handle invalid event files");
      }),
    });

    await waitForDirectoryEntry(config.paths.plugin!.failedDir, ".error.json");
    expect(await readdir(config.paths.plugin!.processedDir)).toEqual([]);

    await transport.stop?.();
    await start;
  });

  it("rejects unsupported plugin event schema versions", async () => {
    const root = await createTempDir();
    const config = createPluginRuntimeConfig(root, {
      response: {
        type: "none",
      },
    });
    const transport = createPluginTransport(config, createMockLogger(), {
      deliveryRouter: createDeliveryRouter(),
    });
    await ensurePluginDirs(config);

    await writeFile(
      join(config.paths.plugin!.inboxDir, "future.json"),
      `${JSON.stringify({
        schemaVersion: 2,
        text: "hello from the future",
      })}\n`,
      "utf8",
    );

    const start = transport.start({
      handle: vi.fn(async () => {
        throw new Error("should not handle unsupported event versions");
      }),
    });

    await waitForDirectoryEntry(config.paths.plugin!.failedDir, ".error.json");
    expect(await readdir(config.paths.plugin!.processedDir)).toEqual([]);

    await transport.stop?.();
    await start;
  });

  it("does not continue polling when stopped during the initial inbox scan", async () => {
    const root = await createTempDir();
    const config = createPluginRuntimeConfig(root, {
      response: {
        type: "none",
      },
    });
    const transport = createPluginTransport(config, createMockLogger(), {
      deliveryRouter: createDeliveryRouter(),
    });
    await ensurePluginDirs(config);

    await writeFile(
      join(config.paths.plugin!.inboxDir, "first.json"),
      `${JSON.stringify({
        id: "first",
        text: "first event",
      })}\n`,
      "utf8",
    );

    let releaseHandler: (() => void) | undefined;
    let resolveHandlerStarted: (() => void) | undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      resolveHandlerStarted = resolve;
    });
    const handle = vi.fn(async () => {
      resolveHandlerStarted?.();
      await new Promise<void>((release) => {
        releaseHandler = release;
      });
    });
    const start = transport.start({ handle });

    await handlerStarted;
    const stopped = transport.stop?.();
    releaseHandler?.();
    await stopped;
    await start;

    await writeFile(
      join(config.paths.plugin!.inboxDir, "second.json"),
      `${JSON.stringify({
        id: "second",
        text: "second event",
      })}\n`,
      "utf8",
    );
    await new Promise((resolve) => setTimeout(resolve, config.ingress.pollIntervalMs * 3));

    expect(handle).toHaveBeenCalledTimes(1);
    expect(await readdir(config.paths.plugin!.inboxDir)).toEqual(["second.json"]);
  });
});

function createPluginRuntimeConfig(
  root: string,
  overrides: Pick<PluginEndpointRuntimeConfig, "response">,
): PluginEndpointRuntimeConfig & ActiveEndpointRuntimeConfig {
  const pluginRoot = join(root, "runtime", "plugins", "pi-audio", "endpoints", "audio-ingress");

  return {
    id: "audio-ingress",
    type: "plugin",
    pluginId: "pi-audio",
    ingress: {
      pollIntervalMs: 10,
      maxEventBytes: 65536,
    },
    response: overrides.response,
    defaultAgentId: "default",
    paths: {
      dataRoot: root,
      endpointRoot: join(root, "endpoints", "audio-ingress"),
      conversationsDir: join(root, "endpoints", "audio-ingress", "conversations"),
      logsDir: join(root, "logs", "endpoints"),
      logFilePath: join(root, "logs", "endpoints", "audio-ingress.log"),
      runtimeDir: join(root, "runtime", "endpoints"),
      runtimeStatePath: join(root, "runtime", "endpoints", "audio-ingress.json"),
      plugin: {
        rootDir: pluginRoot,
        inboxDir: join(pluginRoot, "inbox"),
        processingDir: join(pluginRoot, "processing"),
        processedDir: join(pluginRoot, "processed"),
        failedDir: join(pluginRoot, "failed"),
        outboxDir: join(pluginRoot, "outbox"),
      },
    },
  };
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(async () => {}),
    info: vi.fn(async () => {}),
    error: vi.fn(async () => {}),
  };
}

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-plugin-transport-test-"));
  tempDirs.push(path);
  return path;
}

async function ensurePluginDirs(config: PluginEndpointRuntimeConfig & ActiveEndpointRuntimeConfig): Promise<void> {
  await mkdir(config.paths.plugin!.inboxDir, { recursive: true });
  await mkdir(config.paths.plugin!.processedDir, { recursive: true });
  await mkdir(config.paths.plugin!.failedDir, { recursive: true });
  await mkdir(config.paths.plugin!.outboxDir, { recursive: true });
}

async function waitForDirectoryEntry(dir: string, suffix: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const entries = await readdir(dir).catch(() => []);
    const match = entries.find((entry) => entry.endsWith(suffix));
    if (match) {
      return match;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`No ${suffix} entry appeared in ${dir}.`);
}

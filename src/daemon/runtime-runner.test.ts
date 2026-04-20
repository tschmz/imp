import { describe, expect, it, vi } from "vitest";
import { createAgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import type { ChatRef } from "../domain/conversation.js";
import type { IncomingMessage } from "../domain/message.js";
import type { TransportHandler } from "../transports/types.js";
import type { BootstrappedRuntime } from "./runtime-bootstrap.js";
import { createRuntimeEntries } from "./runtime-runner.js";

describe("createRuntimeEntries", () => {
  it("uses the provided transport factory instead of an internal transport default", async () => {
    const runtime = createRuntime();
    const transport = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    const createTransport = vi.fn(() => transport);
    const entries = createRuntimeEntries([runtime], {
      agentRegistry: createAgentRegistry([
        {
          id: "default",
          name: "Default",
          prompt: {
            base: {
              file: "/agents/default/SYSTEM.md",
            },
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.3",
          },
          tools: [],
          extensions: [],
        },
      ]),
      createTransport,
    });

    await entries[0]?.start();

    expect(createTransport).toHaveBeenCalledWith(
      runtime.endpointConfig,
      runtime.logger,
      expect.objectContaining({
        deliveryRouter: expect.any(Object),
      }),
    );
    expect(transport.start).toHaveBeenCalledOnce();
  });

  it("treats /new text as a priority command before session resolution", async () => {
    const runtime = createRuntime();
    const transport = createCapturingTransport();
    const entries = createRuntimeEntries([runtime], {
      agentRegistry: createAgentRegistry([
        {
          id: "default",
          name: "Default",
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.3",
          },
          tools: [],
          extensions: [],
        },
      ]),
      createTransport: vi.fn(() => transport),
    });

    await entries[0]?.start();
    await transport.handler.handle(
      createEvent({
        endpointId: "private-telegram",
        conversation: {
          transport: "telegram",
          externalId: "42",
        },
        messageId: "99",
        correlationId: "corr-99",
        userId: "7",
        text: "/new",
        receivedAt: "2026-04-07T12:00:00.000Z",
      }),
    );

    expect(runtime.conversationStore.ensureActive).not.toHaveBeenCalled();
    expect(runtime.conversationStore.create).toHaveBeenCalledWith(
      {
        transport: "telegram",
        externalId: "42",
        endpointId: "private-telegram",
      },
      expect.objectContaining({
        agentId: "default",
      }),
    );
    expect(runtime.engine.run).not.toHaveBeenCalled();
  });

  it("treats /status text as a priority command before session resolution", async () => {
    const runtime = createRuntime();
    const transport = createCapturingTransport();
    const entries = createRuntimeEntries([runtime], {
      agentRegistry: createAgentRegistry([
        {
          id: "default",
          name: "Default",
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.3",
          },
          tools: [],
          extensions: [],
        },
      ]),
      createTransport: vi.fn(() => transport),
    });

    await entries[0]?.start();
    await transport.handler.handle(
      createEvent({
        endpointId: "private-telegram",
        conversation: {
          transport: "telegram",
          externalId: "42",
        },
        messageId: "100",
        correlationId: "corr-100",
        userId: "7",
        text: "/status",
        receivedAt: "2026-04-07T12:00:00.000Z",
      }),
    );

    expect(runtime.conversationStore.ensureActive).not.toHaveBeenCalled();
    expect(runtime.conversationStore.get).toHaveBeenCalledWith({
      transport: "telegram",
      externalId: "42",
      endpointId: "private-telegram",
    });
    expect(runtime.conversationStore.listBackups).toHaveBeenCalledWith({
      transport: "telegram",
      externalId: "42",
      endpointId: "private-telegram",
    });
    expect(runtime.engine.run).not.toHaveBeenCalled();
  });

  it("treats /rename text as a priority command before session resolution", async () => {
    const runtime = createRuntime();
    const transport = createCapturingTransport();
    const entries = createRuntimeEntries([runtime], {
      agentRegistry: createAgentRegistry([
        {
          id: "default",
          name: "Default",
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.3",
          },
          tools: [],
          extensions: [],
        },
      ]),
      createTransport: vi.fn(() => transport),
    });

    await entries[0]?.start();
    await transport.handler.handle(
      createEvent({
        endpointId: "private-telegram",
        conversation: {
          transport: "telegram",
          externalId: "42",
        },
        messageId: "100",
        correlationId: "corr-100",
        userId: "7",
        text: "/rename renamed",
        command: "rename",
        commandArgs: "renamed",
        receivedAt: "2026-04-07T12:00:00.000Z",
      }),
    );

    expect(runtime.conversationStore.ensureActive).not.toHaveBeenCalled();
    expect(runtime.conversationStore.get).toHaveBeenCalledWith({
      transport: "telegram",
      externalId: "42",
      endpointId: "private-telegram",
    });
  });

  it("continues a shared agent session while delivering the reply to the current surface", async () => {
    const sharedConversation = {
      state: {
        conversation: {
          transport: "telegram",
          externalId: "42",
          sessionId: "shared-session",
        },
        agentId: "default",
        createdAt: "2026-04-07T11:00:00.000Z",
        updatedAt: "2026-04-07T11:00:00.000Z",
        version: 1,
      },
      messages: [],
    };
    const conversationStore = {
      get: vi.fn(async () => sharedConversation),
      put: vi.fn(async () => undefined),
      listBackups: vi.fn(async () => []),
      restore: vi.fn(async () => false),
      ensureActive: vi.fn(async () => sharedConversation),
      create: vi.fn(async () => sharedConversation),
      getSelectedAgent: vi.fn(async () => "default"),
      ensureActiveForAgent: vi.fn(async () => sharedConversation),
    };
    const engine = {
      run: vi.fn(async ({ message }: { message: IncomingMessage }) => ({
        message: {
          conversation: message.conversation,
          text: "reply to current surface",
        },
        conversationEvents: [],
      })),
      close: vi.fn(async () => undefined),
    };
    const runtime = createRuntime({ conversationStore, engine });
    const transport = createCapturingTransport();
    const event = createEvent({
      endpointId: "audio-ingress",
      conversation: {
        transport: "file",
        externalId: "kitchen",
      },
      messageId: "wake-1",
      correlationId: "corr-wake-1",
      userId: "frontend",
      text: "continue",
      receivedAt: "2026-04-07T12:00:00.000Z",
    });
    const entries = createRuntimeEntries([runtime], {
      agentRegistry: createAgentRegistry([
        {
          id: "default",
          name: "Default",
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.3",
          },
          tools: [],
          extensions: [],
        },
      ]),
      createTransport: vi.fn(() => transport),
    });

    await entries[0]?.start();
    await transport.handler.handle(event);

    expect(conversationStore.ensureActiveForAgent).toHaveBeenCalledWith(
      {
        transport: "file",
        externalId: "kitchen",
        endpointId: "audio-ingress",
      },
      expect.objectContaining({ agentId: "default" }),
    );
    expect(engine.run).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: sharedConversation,
        message: expect.objectContaining({
          conversation: {
            transport: "file",
            externalId: "kitchen",
            endpointId: "audio-ingress",
            sessionId: "shared-session",
            agentId: "default",
          },
        }),
      }),
    );
    expect(event.deliver).toHaveBeenCalledWith({
      conversation: {
        transport: "file",
        externalId: "kitchen",
        endpointId: "audio-ingress",
        sessionId: "shared-session",
        agentId: "default",
      },
      text: "reply to current surface",
    });
  });

  it("uses detached sessions requested by plugin events without replacing the active agent session", async () => {
    const detachedConversation = {
      state: {
        conversation: {
          transport: "file",
          externalId: "imp-phone-call-1",
          endpointId: "phone-ingress",
          sessionId: "imp-phone-call-1",
        },
        agentId: "imp.telebot",
        kind: "phone-call",
        createdAt: "2026-04-07T12:00:00.000Z",
        updatedAt: "2026-04-07T12:00:00.000Z",
        version: 1,
      },
      messages: [],
    };
    const conversationStore = {
      get: vi.fn(async (ref: { sessionId?: string }) =>
        ref.sessionId === "imp-phone-call-1" ? detachedConversation : undefined,
      ),
      put: vi.fn(async () => undefined),
      create: vi.fn(async () => {
        throw new Error("unexpected create fallback");
      }),
      listBackups: vi.fn(async () => []),
      restore: vi.fn(async () => false),
      getSelectedAgent: vi.fn(async () => undefined),
      ensureActive: vi.fn(async () => {
        throw new Error("unexpected ensureActive fallback");
      }),
      ensureActiveForAgent: vi.fn(async () => {
        throw new Error("unexpected ensureActiveForAgent fallback");
      }),
      ensureDetachedForAgent: vi.fn(async () => detachedConversation),
    };
    const engine = {
      run: vi.fn(async ({ message }: { message: IncomingMessage }) => ({
        message: {
          conversation: message.conversation,
          text: "phone reply",
        },
        conversationEvents: [],
      })),
      close: vi.fn(async () => undefined),
    };
    const runtime = createRuntime({
      endpointConfig: {
        id: "phone-ingress",
        type: "file",
        pluginId: "imp-phone",
        defaultAgentId: "default",
        ingress: {
          pollIntervalMs: 250,
          maxEventBytes: 65536,
        },
        response: {
          type: "outbox",
          replyChannel: {
            kind: "phone",
          },
        },
        paths: {
          dataRoot: "/tmp",
          conversationsDir: "/tmp/conversations",
          logsDir: "/tmp/logs/endpoints",
          logFilePath: "/tmp/logs/endpoints/phone-ingress.log",
          runtimeDir: "/tmp/runtime/endpoints",
          runtimeStatePath: "/tmp/runtime/endpoints/phone-ingress.json",
          file: {
            rootDir: "/tmp/runtime/plugins/imp-phone/endpoints/phone-ingress",
            inboxDir: "/tmp/runtime/plugins/imp-phone/endpoints/phone-ingress/inbox",
            processingDir: "/tmp/runtime/plugins/imp-phone/endpoints/phone-ingress/processing",
            processedDir: "/tmp/runtime/plugins/imp-phone/endpoints/phone-ingress/processed",
            failedDir: "/tmp/runtime/plugins/imp-phone/endpoints/phone-ingress/failed",
            outboxDir: "/tmp/runtime/plugins/imp-phone/endpoints/phone-ingress/outbox",
          },
        },
      },
      conversationStore,
      engine,
    });
    const transport = createCapturingTransport();
    const event = createEvent({
      endpointId: "phone-ingress",
      conversation: {
        transport: "file",
        externalId: "imp-phone-call-1",
        sessionId: "imp-phone-call-1",
      },
      messageId: "turn-1",
      correlationId: "corr-turn-1",
      userId: "imp-phone",
      text: "Hallo",
      receivedAt: "2026-04-07T12:00:00.000Z",
      source: {
        kind: "plugin-event",
        plugin: {
          pluginId: "imp-phone",
          eventId: "turn-1",
          fileName: "turn-1.json",
          metadata: {
            session: {
              mode: "detached",
              id: "imp-phone-call-1",
              agentId: "imp.telebot",
              kind: "phone-call",
              title: "Phone call: Thomas",
              metadata: {
                contact_id: "thomas",
              },
            },
          },
        },
      },
    });
    const entries = createRuntimeEntries([runtime], {
      agentRegistry: createAgentRegistry([createTestAgent("default"), createTestAgent("imp.telebot")]),
      createTransport: vi.fn(() => transport),
    });

    await entries[0]?.start();
    await transport.handler.handle(event);

    expect(conversationStore.ensureDetachedForAgent).toHaveBeenCalledWith(
      {
        transport: "file",
        externalId: "imp-phone-call-1",
        sessionId: "imp-phone-call-1",
        endpointId: "phone-ingress",
      },
      {
        agentId: "imp.telebot",
        now: "2026-04-07T12:00:00.000Z",
        kind: "phone-call",
        title: "Phone call: Thomas",
        metadata: {
          contact_id: "thomas",
        },
      },
    );
    expect(conversationStore.ensureActiveForAgent).not.toHaveBeenCalled();
    expect(engine.run).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: detachedConversation,
        message: expect.objectContaining({
          conversation: expect.objectContaining({
            sessionId: "imp-phone-call-1",
            agentId: "imp.telebot",
          }),
        }),
      }),
    );
  });

  it("uses the endpoint default agent when another endpoint selected an agent for the same local chat id", async () => {
    const conversationStore = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
      create: vi.fn(async () => {
        throw new Error("unexpected create fallback");
      }),
      listBackups: vi.fn(async () => []),
      restore: vi.fn(async () => false),
      ensureActive: vi.fn(async () => {
        throw new Error("unexpected ensureActive fallback");
      }),
      getSelectedAgent: vi.fn(async (ref: { endpointId?: string }) =>
        ref.endpointId === "imp.jarvis" || !ref.endpointId ? "jarvis" : undefined,
      ),
      ensureActiveForAgent: vi.fn(async (ref: ChatRef, options: { agentId: string; now: string }) => ({
        state: {
          conversation: {
            ...ref,
            sessionId: `${options.agentId}-session`,
          },
          agentId: options.agentId,
          createdAt: options.now,
          updatedAt: options.now,
          version: 1,
        },
        messages: [],
      })),
    };
    const runtime = createRuntime({
      conversationStore,
      endpointConfig: {
        id: "imp.grimoire",
        type: "cli",
        userId: "local",
        defaultAgentId: "grimoire",
        paths: {
          dataRoot: "/tmp",
          conversationsDir: "/tmp/conversations",
          logsDir: "/tmp/logs/endpoints",
          logFilePath: "/tmp/logs/endpoints/imp.grimoire.log",
          runtimeDir: "/tmp/runtime/endpoints",
          runtimeStatePath: "/tmp/runtime/endpoints/imp.grimoire.json",
        },
      },
    });
    const transport = createCapturingTransport();
    const entries = createRuntimeEntries([runtime], {
      agentRegistry: createAgentRegistry([
        createTestAgent("jarvis"),
        createTestAgent("grimoire"),
      ]),
      createTransport: vi.fn(() => transport),
    });

    await entries[0]?.start();
    await transport.handler.handle(
      createEvent({
        endpointId: "imp.grimoire",
        conversation: {
          transport: "cli",
          externalId: "local",
        },
        messageId: "local-1",
        correlationId: "corr-local-1",
        userId: "local",
        text: "hello",
        receivedAt: "2026-04-07T12:00:00.000Z",
      }),
    );

    expect(conversationStore.getSelectedAgent).toHaveBeenCalledWith({
      transport: "cli",
      externalId: "local",
      endpointId: "imp.grimoire",
    });
    expect(conversationStore.ensureActiveForAgent).toHaveBeenCalledWith(
      {
        transport: "cli",
        externalId: "local",
        endpointId: "imp.grimoire",
      },
      expect.objectContaining({ agentId: "grimoire" }),
    );
  });

  it("closes the runtime engine when the entry stops", async () => {
    const runtime = createRuntime();
    const transport = createCapturingTransport();
    const entries = createRuntimeEntries([runtime], {
      agentRegistry: createAgentRegistry([
        {
          id: "default",
          name: "Default",
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.3",
          },
          tools: [],
          extensions: [],
        },
      ]),
      createTransport: vi.fn(() => transport),
    });

    await entries[0]?.start();
    await entries[0]?.stop();
    await entries[0]?.stop();

    expect(transport.stop).toHaveBeenCalledTimes(1);
    expect(runtime.engine.close).toHaveBeenCalledTimes(1);
  });

  it("logs configured agent resources to the agent log at runtime start", async () => {
    const runtime = createRuntime();
    const transport = createCapturingTransport();
    const agentLogger = {
      debug: vi.fn(async () => undefined),
      info: vi.fn(async () => undefined),
      error: vi.fn(async () => undefined),
    };
    runtime.agentLoggers.forAgent = vi.fn(() => agentLogger);
    const entries = createRuntimeEntries([runtime], {
      agentRegistry: createAgentRegistry([
        {
          id: "default",
          name: "Default",
          prompt: {
            base: {
              text: "You are concise.",
            },
            instructions: [
              { file: "/agents/default/STYLE.md" },
              { text: "Inline instruction." },
            ],
            references: [
              { file: "/agents/default/RUNBOOK.md" },
            ],
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.3",
          },
          skillCatalog: [
            {
              name: "commit",
              description: "Stage and commit changes.",
              directoryPath: "/skills/commit",
              filePath: "/skills/commit/SKILL.md",
              body: "\nUse focused commits.",
              content: "---\nname: commit\ndescription: Stage and commit changes.\n---\n\nUse focused commits.",
              references: [],
              scripts: [],
            },
          ],
          tools: [],
          extensions: [],
        },
      ]),
      createTransport: vi.fn(() => transport),
    });

    await entries[0]?.start();

    expect(runtime.logger.info).not.toHaveBeenCalledWith(
      "loaded configured agent skills",
      expect.anything(),
    );
    expect(runtime.agentLoggers.forAgent).toHaveBeenCalledWith("default");
    expect(agentLogger.info).toHaveBeenCalledWith(
      "loaded configured base prompt",
      expect.objectContaining({
        agentId: "default",
        basePromptSource: "text",
      }),
    );
    expect(agentLogger.info).toHaveBeenCalledWith(
      "loaded configured agent skills",
      expect.objectContaining({
        agentId: "default",
        configuredSkillCount: 1,
        configuredSkillNames: ["commit"],
      }),
    );
    expect(agentLogger.info).toHaveBeenCalledWith(
      "loaded configured instruction files",
      expect.objectContaining({
        agentId: "default",
        configuredInstructionFileCount: 1,
        configuredInstructionFiles: ["/agents/default/STYLE.md"],
      }),
    );
    expect(agentLogger.info).toHaveBeenCalledWith(
      "loaded configured reference files",
      expect.objectContaining({
        agentId: "default",
        configuredReferenceFileCount: 1,
        configuredReferenceFiles: ["/agents/default/RUNBOOK.md"],
      }),
    );
  });

  it("passes current endpoint reply channel context into agent runs", async () => {
    const runtime = createRuntime();
    const transport = createCapturingTransport();
    const entries = createRuntimeEntries([runtime], {
      agentRegistry: createAgentRegistry([
        {
          id: "default",
          name: "Default",
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.3",
          },
          tools: [],
          extensions: [],
        },
      ]),
      createTransport: vi.fn(() => transport),
    });

    await entries[0]?.start();
    await transport.handler.handle(
      createEvent({
        endpointId: "private-telegram",
        conversation: {
          transport: "telegram",
          externalId: "42",
        },
        messageId: "101",
        correlationId: "corr-101",
        userId: "7",
        text: "hello",
        receivedAt: "2026-04-07T12:00:00.000Z",
      }),
    );

    expect(runtime.engine.run).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({
          replyChannel: {
            kind: "telegram",
            delivery: "endpoint",
            endpointId: "private-telegram",
          },
        }),
      }),
    );
  });

  it("passes file endpoint target reply channel context into agent runs", async () => {
    const telegramRuntime = createRuntime();
    const pluginRuntime = createRuntime({
      endpointConfig: {
        id: "audio-ingress",
        type: "file",
        pluginId: "pi-audio",
        ingress: {
          pollIntervalMs: 250,
          maxEventBytes: 65536,
        },
        response: {
          type: "endpoint",
          endpointId: "private-telegram",
          target: {
            conversationId: "42",
          },
        },
        defaultAgentId: "default",
        paths: {
          dataRoot: "/tmp",
          conversationsDir: "/tmp/endpoints/audio-ingress/conversations",
          logsDir: "/tmp/logs/endpoints",
          logFilePath: "/tmp/logs/endpoints/audio-ingress.log",
          runtimeDir: "/tmp/runtime/endpoints",
          runtimeStatePath: "/tmp/runtime/endpoints/audio-ingress.json",
          file: {
            rootDir: "/tmp/runtime/plugins/pi-audio/endpoints/audio-ingress",
            inboxDir: "/tmp/runtime/plugins/pi-audio/endpoints/audio-ingress/inbox",
            processingDir: "/tmp/runtime/plugins/pi-audio/endpoints/audio-ingress/processing",
            processedDir: "/tmp/runtime/plugins/pi-audio/endpoints/audio-ingress/processed",
            failedDir: "/tmp/runtime/plugins/pi-audio/endpoints/audio-ingress/failed",
            outboxDir: "/tmp/runtime/plugins/pi-audio/endpoints/audio-ingress/outbox",
          },
        },
      },
    });
    const telegramTransport = createCapturingTransport();
    const pluginTransport = createCapturingTransport();
    const entries = createRuntimeEntries([telegramRuntime, pluginRuntime], {
      agentRegistry: createAgentRegistry([
        {
          id: "default",
          name: "Default",
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.3",
          },
          tools: [],
          extensions: [],
        },
      ]),
      createTransport: vi.fn((config) =>
        config.id === "audio-ingress" ? pluginTransport : telegramTransport,
      ),
    });

    await Promise.all(entries.map((entry) => entry.start()));
    await pluginTransport.handler.handle(
      createEvent({
        endpointId: "audio-ingress",
        conversation: {
          transport: "file",
          externalId: "kitchen",
        },
        messageId: "wake-1",
        correlationId: "corr-wake-1",
        userId: "frontend",
        text: "hello",
        receivedAt: "2026-04-07T12:00:00.000Z",
      }),
    );

    expect(pluginRuntime.engine.run).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({
          replyChannel: {
            kind: "telegram",
            delivery: "endpoint",
            endpointId: "private-telegram",
          },
        }),
      }),
    );
  });

  it("passes plugin outbox and none reply channel context into agent runs", async () => {
    const outboxRuntime = createRuntime({
      endpointConfig: {
        id: "audio-ingress",
        type: "file",
        pluginId: "pi-audio",
        ingress: {
          pollIntervalMs: 250,
          maxEventBytes: 65536,
        },
        response: {
          type: "outbox",
          replyChannel: {
            kind: "audio",
          },
        },
        defaultAgentId: "default",
        paths: {
          dataRoot: "/tmp",
          conversationsDir: "/tmp/endpoints/audio-ingress/conversations",
          logsDir: "/tmp/logs/endpoints",
          logFilePath: "/tmp/logs/endpoints/audio-ingress.log",
          runtimeDir: "/tmp/runtime/endpoints",
          runtimeStatePath: "/tmp/runtime/endpoints/audio-ingress.json",
          file: {
            rootDir: "/tmp/runtime/plugins/pi-audio/endpoints/audio-ingress",
            inboxDir: "/tmp/runtime/plugins/pi-audio/endpoints/audio-ingress/inbox",
            processingDir: "/tmp/runtime/plugins/pi-audio/endpoints/audio-ingress/processing",
            processedDir: "/tmp/runtime/plugins/pi-audio/endpoints/audio-ingress/processed",
            failedDir: "/tmp/runtime/plugins/pi-audio/endpoints/audio-ingress/failed",
            outboxDir: "/tmp/runtime/plugins/pi-audio/endpoints/audio-ingress/outbox",
          },
        },
      },
    });
    const noneRuntime = createRuntime({
      endpointConfig: {
        id: "silent-ingress",
        type: "file",
        pluginId: "pi-audio",
        ingress: {
          pollIntervalMs: 250,
          maxEventBytes: 65536,
        },
        response: {
          type: "none",
        },
        defaultAgentId: "default",
        paths: {
          dataRoot: "/tmp",
          conversationsDir: "/tmp/endpoints/silent-ingress/conversations",
          logsDir: "/tmp/logs/endpoints",
          logFilePath: "/tmp/logs/endpoints/silent-ingress.log",
          runtimeDir: "/tmp/runtime/endpoints",
          runtimeStatePath: "/tmp/runtime/endpoints/silent-ingress.json",
          file: {
            rootDir: "/tmp/runtime/plugins/pi-audio/endpoints/silent-ingress",
            inboxDir: "/tmp/runtime/plugins/pi-audio/endpoints/silent-ingress/inbox",
            processingDir: "/tmp/runtime/plugins/pi-audio/endpoints/silent-ingress/processing",
            processedDir: "/tmp/runtime/plugins/pi-audio/endpoints/silent-ingress/processed",
            failedDir: "/tmp/runtime/plugins/pi-audio/endpoints/silent-ingress/failed",
            outboxDir: "/tmp/runtime/plugins/pi-audio/endpoints/silent-ingress/outbox",
          },
        },
      },
    });
    const outboxTransport = createCapturingTransport();
    const noneTransport = createCapturingTransport();
    const entries = createRuntimeEntries([outboxRuntime, noneRuntime], {
      agentRegistry: createAgentRegistry([
        {
          id: "default",
          name: "Default",
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          model: {
            provider: "openai",
            modelId: "gpt-5.3",
          },
          tools: [],
          extensions: [],
        },
      ]),
      createTransport: vi.fn((config) =>
        config.id === "silent-ingress" ? noneTransport : outboxTransport,
      ),
    });

    await Promise.all(entries.map((entry) => entry.start()));
    await outboxTransport.handler.handle(
      createEvent({
        endpointId: "audio-ingress",
        conversation: {
          transport: "file",
          externalId: "kitchen",
        },
        messageId: "wake-1",
        correlationId: "corr-wake-1",
        userId: "frontend",
        text: "hello",
        receivedAt: "2026-04-07T12:00:00.000Z",
      }),
    );
    await noneTransport.handler.handle(
      createEvent({
        endpointId: "silent-ingress",
        conversation: {
          transport: "file",
          externalId: "kitchen",
        },
        messageId: "wake-2",
        correlationId: "corr-wake-2",
        userId: "frontend",
        text: "hello",
        receivedAt: "2026-04-07T12:00:00.000Z",
      }),
    );

    expect(outboxRuntime.engine.run).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({
          replyChannel: {
            kind: "audio",
            delivery: "outbox",
          },
        }),
      }),
    );
    expect(noneRuntime.engine.run).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({
          replyChannel: {
            kind: "none",
            delivery: "none",
          },
        }),
      }),
    );
  });

  it("lets plugin event response overrides set none reply channel context", async () => {
    const runtime = createRuntime({
      endpointConfig: {
        id: "phone-ingress",
        type: "file",
        pluginId: "imp-phone",
        ingress: {
          pollIntervalMs: 250,
          maxEventBytes: 65536,
        },
        response: {
          type: "outbox",
          replyChannel: {
            kind: "phone",
          },
        },
        defaultAgentId: "default",
        paths: {
          dataRoot: "/tmp",
          conversationsDir: "/tmp/endpoints/phone-ingress/conversations",
          logsDir: "/tmp/logs/endpoints",
          logFilePath: "/tmp/logs/endpoints/phone-ingress.log",
          runtimeDir: "/tmp/runtime/endpoints",
          runtimeStatePath: "/tmp/runtime/endpoints/phone-ingress.json",
          file: {
            rootDir: "/tmp/runtime/plugins/imp-phone/endpoints/phone-ingress",
            inboxDir: "/tmp/runtime/plugins/imp-phone/endpoints/phone-ingress/inbox",
            processingDir: "/tmp/runtime/plugins/imp-phone/endpoints/phone-ingress/processing",
            processedDir: "/tmp/runtime/plugins/imp-phone/endpoints/phone-ingress/processed",
            failedDir: "/tmp/runtime/plugins/imp-phone/endpoints/phone-ingress/failed",
            outboxDir: "/tmp/runtime/plugins/imp-phone/endpoints/phone-ingress/outbox",
          },
        },
      },
    });
    const transport = createCapturingTransport();
    const entries = createRuntimeEntries([runtime], {
      agentRegistry: createAgentRegistry([createTestAgent("default")]),
      createTransport: vi.fn(() => transport),
    });

    await entries[0]?.start();
    await transport.handler.handle(
      createEvent({
        endpointId: "phone-ingress",
        conversation: {
          transport: "file",
          externalId: "imp-phone-call-1",
        },
        messageId: "closed-1",
        correlationId: "corr-closed-1",
        userId: "imp-phone",
        text: "finalize notes",
        receivedAt: "2026-04-07T12:00:00.000Z",
        source: {
          kind: "plugin-event",
          plugin: {
            pluginId: "imp-phone",
            eventId: "closed-1",
            fileName: "closed.json",
            metadata: {
              response: {
                type: "none",
              },
            },
          },
        },
      }),
    );

    expect(runtime.engine.run).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({
          replyChannel: {
            kind: "none",
            delivery: "none",
          },
        }),
      }),
    );
  });
});

function createCapturingTransport(): {
  handler: TransportHandler;
  start: (handler: TransportHandler) => Promise<void>;
  stop: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  let capturedHandler: TransportHandler | undefined;

  return {
    get handler() {
      if (!capturedHandler) {
        throw new Error("transport handler was not registered");
      }

      return capturedHandler;
    },
    start: vi.fn(async (handler: TransportHandler) => {
      capturedHandler = handler;
    }),
    stop: vi.fn(async () => undefined),
  };
}

function createEvent(message: IncomingMessage) {
  return {
    message,
    deliver: vi.fn(async () => undefined),
    runWithProcessing: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
  };
}

function createTestAgent(id: string): AgentDefinition {
  return {
    id,
    name: id,
    prompt: {
      base: {
        text: "You are concise.",
      },
    },
    model: {
      provider: "openai",
      modelId: "gpt-5.3",
    },
    tools: [],
    extensions: [],
  };
}

function createRuntime(overrides: Partial<BootstrappedRuntime> = {}): BootstrappedRuntime {
  const runtime: BootstrappedRuntime = {
    endpointConfig: overrides.endpointConfig ?? {
      id: "private-telegram",
      type: "telegram",
      token: "123:abc",
      allowedUserIds: ["7"],
      defaultAgentId: "default",
      paths: {
        dataRoot: "/tmp",
        conversationsDir: "/tmp/endpoints/private-telegram/conversations",
        logsDir: "/tmp/logs/endpoints",
        logFilePath: "/tmp/logs/endpoints/private-telegram.log",
        runtimeDir: "/tmp/runtime/endpoints",
        runtimeStatePath: "/tmp/runtime/endpoints/private-telegram.json",
      },
    },
    configPath: overrides.configPath ?? "/tmp/config.json",
    loggingLevel: overrides.loggingLevel ?? "info",
    logger: overrides.logger ?? {
      debug: vi.fn(async () => undefined),
      info: vi.fn(async () => undefined),
      error: vi.fn(async () => undefined),
    },
    endpointLogger: overrides.endpointLogger ?? {
      debug: vi.fn(async () => undefined),
      info: vi.fn(async () => undefined),
      error: vi.fn(async () => undefined),
    },
    agentLoggers: overrides.agentLoggers ?? {
      forAgent: vi.fn(() => ({
        debug: vi.fn(async () => undefined),
        info: vi.fn(async () => undefined),
        error: vi.fn(async () => undefined),
      })),
    },
    conversationStore: overrides.conversationStore ?? {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
      listBackups: vi.fn(async () => []),
      restore: vi.fn(async () => false),
      ensureActive: vi.fn(async (ref, options) => ({
        state: {
          conversation: {
            ...ref,
            sessionId: "session-1",
          },
          agentId: options.agentId,
          createdAt: options.now,
          updatedAt: options.now,
          version: 1,
        },
        messages: [],
      })),
      create: vi.fn(async (ref, options) => ({
        state: {
          conversation: {
            ...ref,
            sessionId: "session-1",
          },
          agentId: options.agentId,
          createdAt: options.now,
          updatedAt: options.now,
          version: 1,
        },
        messages: [],
      })),
    },
    engine: overrides.engine ?? {
      run: vi.fn(async () => ({
        message: {
          conversation: {
            transport: "telegram",
            externalId: "42",
          },
          text: "reply",
        },
        conversationEvents: [],
      })),
      close: vi.fn(async () => undefined),
    },
  };

  return runtime;
}

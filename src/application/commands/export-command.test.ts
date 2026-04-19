import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ConversationContext } from "../../domain/conversation.js";
import { exportCommandHandler } from "./export-command.js";
import {
  createCommandContext,
  createDependencies,
  createIncomingMessage,
  createMutableConversationStore,
} from "./test-helpers.js";

describe("exportCommandHandler", () => {
  it("creates a readable HTML export for the current session", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "imp-export-test-"));
    const conversationStore = createMutableConversationStore(createConversation());
    const context = createCommandContext({
      message: createIncomingMessage("export"),
      dependencies: createDependencies({
        conversationStore,
        runtimeInfo: createRuntimeInfo(dataRoot),
      }),
    });

    const response = await exportCommandHandler.handle(context);
    const exportPath = extractExportPath(response?.text);
    const html = await readFile(exportPath, "utf8");

    expect(exportCommandHandler.canHandle("export")).toBe(true);
    expect(response?.text).toContain("Export created.");
    expect(response?.text).toContain("Mode: readable");
    expect(response?.text).toContain("Format: HTML");
    expect(response?.text).toContain("Link: file://");
    expect(exportPath).toContain(join(dataRoot, "exports", "default", "session-1"));
    expect(html).toContain("Conversation export");
    expect(html).toContain("<dd>readable</dd>");
    expect(html).toContain("Hello &lt;team&gt;");
    expect(html).toContain("Implemented the change.");
    expect(html).toContain("cmd: npm test");
    expect(html).toContain("Technical details are available in full export mode.");
    expect(html).not.toContain('"workingDirectory"');
  });

  it("creates a full HTML export with tool details", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "imp-export-test-"));
    const context = createCommandContext({
      message: createIncomingMessage("export", "full"),
      dependencies: createDependencies({
        conversationStore: createMutableConversationStore(createConversation()),
        runtimeInfo: createRuntimeInfo(dataRoot),
      }),
    });

    const response = await exportCommandHandler.handle(context);
    const html = await readFile(extractExportPath(response?.text), "utf8");

    expect(response?.text).toContain("Mode: full");
    expect(html).toContain("<dd>full</dd>");
    expect(html).toContain("test/stub");
    expect(html).toContain("&quot;cmd&quot;: &quot;npm test&quot;");
    expect(html).toContain("&quot;workingDirectory&quot;: &quot;/workspace&quot;");
    expect(html).toContain("all tests passed");
    expect(html).toContain("Internal thinking: present, content omitted.");
    expect(html).toContain("<details><summary>Tool result: shell (ok)</summary>");
    expect(html).not.toContain("<details open><summary>Tool result: shell (ok)</summary>");
  });

  it("returns usage text for unsupported export options", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("export", "pdf"),
      dependencies: createDependencies({}),
    });

    const response = await exportCommandHandler.handle(context);

    expect(response?.text).toBe("Usage: /export [readable|full] [html]");
  });

  it("returns a clear message when there is no active session", async () => {
    const context = createCommandContext({
      message: createIncomingMessage("export"),
      dependencies: createDependencies({}),
    });

    const response = await exportCommandHandler.handle(context);

    expect(response?.text).toBe("There is no active session to export.");
  });
});

function createConversation(): ConversationContext {
  return {
    state: {
      conversation: {
        transport: "telegram",
        externalId: "42",
        sessionId: "session-1",
      },
      agentId: "default",
      title: "Sprint export",
      workingDirectory: "/workspace",
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:02:00.000Z",
      version: 1,
    },
    messages: [
      {
        id: "msg-1",
        role: "user",
        content: "Hello <team>",
        timestamp: Date.parse("2026-04-05T00:00:10.000Z"),
        createdAt: "2026-04-05T00:00:10.000Z",
      },
      {
        id: "msg-2",
        role: "assistant",
        content: [
          { type: "text", text: "Implemented the change." },
          { type: "thinking", thinking: "private chain", thinkingSignature: "sig" },
          {
            type: "toolCall",
            id: "call-1",
            name: "shell",
            arguments: { cmd: "npm test" },
          },
        ],
        timestamp: Date.parse("2026-04-05T00:00:20.000Z"),
        createdAt: "2026-04-05T00:00:20.000Z",
        api: "test",
        provider: "test",
        model: "stub",
        stopReason: "stop",
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
      {
        id: "msg-3",
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "shell",
        isError: false,
        content: [{ type: "text", text: "all tests passed" }],
        details: { workingDirectory: "/workspace" },
        timestamp: Date.parse("2026-04-05T00:00:30.000Z"),
        createdAt: "2026-04-05T00:00:30.000Z",
      },
    ],
  };
}

function createRuntimeInfo(dataRoot: string) {
  return {
    endpointId: "private-telegram",
    configPath: "/tmp/config.json",
    dataRoot,
    logFilePath: "/tmp/private-telegram.log",
    loggingLevel: "info" as const,
    activeEndpointIds: ["private-telegram"],
  };
}

function extractExportPath(text: string | undefined): string {
  const match = text?.match(/^Path: (.+)$/m);
  if (!match) {
    throw new Error(`missing export path in response: ${text}`);
  }

  return match[1];
}

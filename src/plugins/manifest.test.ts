import { describe, expect, it } from "vitest";
import { pluginManifestSchema } from "./manifest.js";

describe("pluginManifestSchema", () => {
  it("accepts installable service plugin manifests", () => {
    const result = pluginManifestSchema.safeParse({
      schemaVersion: 1,
      id: "imp-voice",
      name: "imp Voice",
      version: "0.1.0",
      description: "Local voice frontend for imp.",
      capabilities: ["voice", "audio", "wake-word", "speech-output"],
      endpoints: [
        {
          id: "audio-ingress",
          ingress: {
            pollIntervalMs: 500,
            maxEventBytes: 65536,
          },
          response: {
            type: "outbox",
            replyChannel: {
              kind: "audio",
            },
            speech: {
              enabled: true,
              language: "de",
            },
          },
        },
      ],
      services: [
        {
          id: "wake",
          command: "node",
          args: ["dist/wake-service.js"],
          env: {
            OPENAI_API_KEY: "required",
          },
        },
      ],
      runtime: {
        module: "./dist/plugin.mjs",
      },
      mcpServers: [
        {
          id: "voice-tools",
          command: "node",
          args: ["dist/mcp-server.js"],
          inheritEnv: ["OPENAI_API_KEY"],
        },
      ],
      setup: {
        python: {
          requirements: "requirements.txt",
        },
      },
      init: {
        configTemplate: "templates/config.default.json",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects duplicate endpoint ids", () => {
    const result = pluginManifestSchema.safeParse({
      schemaVersion: 1,
      id: "imp-voice",
      name: "imp Voice",
      version: "0.1.0",
      endpoints: [
        {
          id: "audio-ingress",
          response: {
            type: "none",
          },
        },
        {
          id: "audio-ingress",
          response: {
            type: "none",
          },
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected schema validation to fail.");
    }

    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["endpoints", 1, "id"],
        message: 'Duplicate endpoint id "audio-ingress". Endpoint ids must be unique per plugin.',
      }),
    );
  });

  it("accepts delegated agent tools for plugin agents", () => {
    const result = pluginManifestSchema.safeParse({
      schemaVersion: 1,
      id: "trading-agents",
      name: "Trading Agents",
      version: "0.1.0",
      agents: [
        {
          id: "trading-forex",
          prompt: { base: { text: "Desk" } },
          tools: {
            agents: [
              {
                agentId: "forex-risk-manager",
                toolName: "consult_risk_manager",
                description: "Ask the Forex risk manager.",
              },
            ],
          },
        },
        {
          id: "forex-risk-manager",
          prompt: { base: { text: "Risk" } },
        },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected schema validation to pass.");
    }

    expect(result.data.agents?.[0]?.tools).toEqual({
      agents: [
        {
          agentId: "forex-risk-manager",
          toolName: "consult_risk_manager",
          description: "Ask the Forex risk manager.",
        },
      ],
    });
  });
});

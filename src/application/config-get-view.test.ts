import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config/types.js";
import { getValueAtKeyPath } from "./config-key-path.js";
import { createConfigGetView } from "./config-get-view.js";

describe("createConfigGetView", () => {
  it("materializes effective agent defaults for config get", () => {
    const view = createConfigGetView(createConfig());

    expect(getValueAtKeyPath(view, "logging.level")).toBe("info");
    expect(getValueAtKeyPath(view, "logging.rotationSize")).toBe("5M");
    expect(getValueAtKeyPath(view, "agents.jarvis.name")).toBe("jarvis");
    expect(getValueAtKeyPath(view, "agents.jarvis.model")).toEqual({
      provider: "openai",
      modelId: "gpt-5.5",
    });
    expect(getValueAtKeyPath(view, "agents.jarvis.home")).toBe("/var/lib/imp/agents/jarvis");
    expect(getValueAtKeyPath(view, "agents.jarvis.prompt.base")).toEqual({ builtIn: "default" });
    expect(getValueAtKeyPath(view, "agents.jarvis.tools")).toEqual([]);
  });

  it("preserves explicit agent overrides", () => {
    const view = createConfigGetView({
      ...createConfig(),
      agents: [
        {
          id: "jarvis",
          name: "Jarvis",
          home: "./agents/jarvis",
          prompt: {
            base: {
              text: "custom",
            },
          },
          tools: {
            builtIn: ["read"],
          },
        },
      ],
    });

    expect(getValueAtKeyPath(view, "agents.jarvis.name")).toBe("Jarvis");
    expect(getValueAtKeyPath(view, "agents.jarvis.home")).toBe("./agents/jarvis");
    expect(getValueAtKeyPath(view, "agents.jarvis.prompt.base")).toEqual({ text: "custom" });
    expect(getValueAtKeyPath(view, "agents.jarvis.tools.builtIn")).toEqual(["read"]);
  });

  it("materializes effective endpoint defaults for config get", () => {
    const view = createConfigGetView(createConfig());

    expect(getValueAtKeyPath(view, "endpoints.telegram.routing.defaultAgentId")).toBe("jarvis");
    expect(getValueAtKeyPath(view, "endpoints.telegram.document.maxDownloadBytes")).toBe(20 * 1024 * 1024);
    expect(getValueAtKeyPath(view, "endpoints.file.ingress.pollIntervalMs")).toBe(1000);
    expect(getValueAtKeyPath(view, "endpoints.file.ingress.maxEventBytes")).toBe(256 * 1024);
  });
});

function createConfig(): AppConfig {
  return {
    instance: {
      name: "default",
    },
    paths: {
      dataRoot: "/var/lib/imp",
    },
    defaults: {
      agentId: "jarvis",
      model: {
        provider: "openai",
        modelId: "gpt-5.5",
      },
    },
    agents: [
      {
        id: "jarvis",
      },
    ],
    endpoints: [
      {
        id: "telegram",
        type: "telegram",
        enabled: true,
        token: "token",
        access: {
          allowedUserIds: [],
        },
      },
      {
        id: "file",
        type: "file",
        enabled: true,
        pluginId: "imp-file",
        response: {
          type: "none",
        },
      },
    ],
  };
}

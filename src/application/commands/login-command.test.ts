import { describe, expect, it, vi } from "vitest";
import { createAgentRegistry } from "../../agents/registry.js";
import { loginCommandHandler } from "./login-command.js";
import { createCommandContext, createDefaultAgent, createDependencies, createIncomingMessage } from "./test-helpers.js";

describe("loginCommandHandler", () => {
  it("logs in to the selected OAuth provider and sends device-code progress", async () => {
    const agent = {
      ...createDefaultAgent(),
      model: {
        provider: "openai-codex",
        modelId: "gpt-5.1-codex-max",
        authFile: "/tmp/imp-auth.json",
      },
    };
    const progress = vi.fn(async () => {});
    const loginModelProvider = vi.fn(async ({ notify, prompt }) => {
      await expect(prompt({
        type: "select",
        message: "Select login method",
        options: [
          { id: "browser", label: "Browser login" },
          { id: "device_code", label: "Device code login" },
        ],
      })).resolves.toBe("device_code");
      await notify({
        type: "device_code",
        userCode: "ABCD-EFGH",
        verificationUri: "https://example.test/device",
        expiresInSeconds: 900,
      });
    });

    const response = await loginCommandHandler.handle(createCommandContext({
      message: createIncomingMessage("login"),
      dependencies: createDependencies({
        agentRegistry: createAgentRegistry([agent]),
        loginModelProvider,
      }),
      deliverProgress: progress,
    }));

    expect(loginModelProvider).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai-codex",
      authFile: "/tmp/imp-auth.json",
    }));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("Code: `ABCD-EFGH`"),
    }));
    expect(response?.text).toContain("Login complete");
  });

  it("uses an explicit provider argument", async () => {
    const agent = {
      ...createDefaultAgent(),
      model: {
        provider: "openai-codex",
        modelId: "gpt-5.1-codex-max",
        authFile: "/tmp/imp-auth.json",
      },
    };
    const loginModelProvider = vi.fn(async () => {});

    await loginCommandHandler.handle(createCommandContext({
      message: createIncomingMessage("login", "openai-codex"),
      dependencies: createDependencies({
        agentRegistry: createAgentRegistry([agent]),
        loginModelProvider,
      }),
    }));

    expect(loginModelProvider).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai-codex",
    }));
  });

  it("rejects non-OAuth providers", async () => {
    const response = await loginCommandHandler.handle(createCommandContext({
      message: createIncomingMessage("login", "openai"),
      dependencies: createDependencies({}),
    }));

    expect(response?.text).toContain("does not support OAuth login");
  });

  it("requires an authFile on the selected agent", async () => {
    const agent = {
      ...createDefaultAgent(),
      model: {
        provider: "openai-codex",
        modelId: "gpt-5.1-codex-max",
      },
    };

    const response = await loginCommandHandler.handle(createCommandContext({
      message: createIncomingMessage("login"),
      dependencies: createDependencies({ agentRegistry: createAgentRegistry([agent]) }),
    }));

    expect(response?.text).toContain("authFile");
  });
});

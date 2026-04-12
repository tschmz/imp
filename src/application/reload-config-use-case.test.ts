import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/types.js";
import type { ServiceOperationResult } from "../service/service-operation-result.js";
import { createReloadConfigUseCase } from "./reload-config-use-case.js";

describe("createReloadConfigUseCase", () => {
  it("discovers, validates, and reloads the resolved config by restarting the matching service", async () => {
    const discoverConfigPath = vi.fn(async () => ({
      configPath: "/etc/imp/config.json",
      checkedPaths: ["/etc/imp/config.json"],
    }));
    const loadAppConfig = vi.fn(async () => createValidAppConfig());
    const resolveServiceTarget = vi.fn(() => ({
      configPath: "/etc/imp/config.json",
      platform: "linux-systemd-user" as const,
      definitionPath: "/tmp/imp.service",
      serviceName: "imp",
      serviceLabel: "dev.imp",
    }));
    const restartService = vi.fn(async (): Promise<ServiceOperationResult> => ({
      operation: "restart",
      platform: "linux-systemd-user",
      serviceName: "imp",
      definitionPath: "/tmp/imp.service",
    }));
    const writeOutput = vi.fn();
    const reloadConfig = createReloadConfigUseCase({
      discoverConfigPath,
      loadAppConfig,
      resolveServiceTarget,
      restartService,
      writeOutput,
    });

    await reloadConfig({});

    expect(discoverConfigPath).toHaveBeenCalledWith({ cliConfigPath: undefined });
    expect(loadAppConfig).toHaveBeenCalledWith("/etc/imp/config.json");
    expect(resolveServiceTarget).toHaveBeenCalledWith({
      cliConfigPath: "/etc/imp/config.json",
    });
    expect(restartService).toHaveBeenCalledWith({
      configPath: "/etc/imp/config.json",
      platform: "linux-systemd-user",
      definitionPath: "/tmp/imp.service",
      serviceName: "imp",
      serviceLabel: "dev.imp",
    });
    expect(writeOutput).toHaveBeenCalledWith(
      "Validated /etc/imp/config.json; reloaded it by restarting linux-systemd-user service imp.",
    );
  });

  it("uses an explicit --config path for validation and restart targeting", async () => {
    const discoverConfigPath = vi.fn(
      async (options?: { cliConfigPath?: string; env?: NodeJS.ProcessEnv }) => ({
        configPath: options?.cliConfigPath ?? "/unexpected.json",
        checkedPaths: [options?.cliConfigPath ?? "/unexpected.json"],
      }),
    );
    const loadAppConfig = vi.fn(async () => createValidAppConfig());
    const resolveServiceTarget = vi.fn(() => ({
      configPath: "/tmp/custom.json",
      platform: "macos-launchd-agent" as const,
      definitionPath: "/tmp/dev.imp.plist",
      serviceName: "imp",
      serviceLabel: "dev.imp",
    }));
    const restartService = vi.fn(async (): Promise<ServiceOperationResult> => ({
      operation: "restart",
      platform: "macos-launchd-agent",
      serviceName: "imp",
      definitionPath: "/tmp/dev.imp.plist",
    }));
    const reloadConfig = createReloadConfigUseCase({
      discoverConfigPath,
      loadAppConfig,
      resolveServiceTarget,
      restartService,
      writeOutput: vi.fn(),
    });

    await reloadConfig({ configPath: "/tmp/custom.json" });

    expect(discoverConfigPath).toHaveBeenCalledWith({ cliConfigPath: "/tmp/custom.json" });
    expect(loadAppConfig).toHaveBeenCalledWith("/tmp/custom.json");
    expect(resolveServiceTarget).toHaveBeenCalledWith({
      cliConfigPath: "/tmp/custom.json",
    });
  });
});

function createValidAppConfig(): AppConfig {
  return {
    instance: { name: "imp" },
    paths: { dataRoot: "/tmp/imp" },
    defaults: { agentId: "default" },
    agents: [
      {
        id: "default",
        prompt: {
          base: {
            text: "prompt",
          },
        },
        model: {
          provider: "openai",
          modelId: "gpt-5",
        },
      },
    ],
    endpoints: [
      {
        id: "private-telegram",
        type: "telegram" as const,
        enabled: true,
        token: "token",
        access: {
          allowedUserIds: [],
        },
      },
    ],
  };
}

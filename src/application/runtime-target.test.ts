import { describe, expect, it, vi } from "vitest";
import { getDefaultUserConfigPath } from "../config/discover-config-path.js";
import { createServiceInstallPlan } from "../service/install-plan.js";
import { resolveServiceDefinitionPath } from "../service/install-service.js";
import {
  createRuntimeTransportFactory,
  resolveServiceConfigPath,
  resolveServiceTarget,
} from "./runtime-target.js";

const { createTransportMock } = vi.hoisted(() => ({
  createTransportMock: vi.fn(),
}));

vi.mock("../transports/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../transports/registry.js")>();
  return {
    ...actual,
    createTransport: createTransportMock,
  };
});

describe("resolveServiceConfigPath", () => {
  it("prefers --config over IMP_CONFIG_PATH", () => {
    const resolved = resolveServiceConfigPath({
      cliConfigPath: "/tmp/from-cli.json",
      env: {
        IMP_CONFIG_PATH: "/tmp/from-env.json",
      },
    });

    expect(resolved).toBe("/tmp/from-cli.json");
  });

  it("uses IMP_CONFIG_PATH when --config is omitted", () => {
    const resolved = resolveServiceConfigPath({
      env: {
        IMP_CONFIG_PATH: "/tmp/from-env.json",
      },
    });

    expect(resolved).toBe("/tmp/from-env.json");
  });

  it("falls back to the default user config path", () => {
    const env = {
      XDG_CONFIG_HOME: "/tmp/custom-config-home",
    };

    const resolved = resolveServiceConfigPath({ env });

    expect(resolved).toBe(getDefaultUserConfigPath(env));
  });
});

describe("resolveServiceTarget", () => {
  it("builds a service target from --config", () => {
    const configPath = "/tmp/from-cli.json";

    const target = resolveServiceTarget({
      cliConfigPath: configPath,
      env: {
        IMP_CONFIG_PATH: "/tmp/from-env.json",
      },
    });
    const plan = createServiceInstallPlan({ configPath });

    expect(target.configPath).toBe(configPath);
    expect(target.platform).toBe(plan.platform);
    expect(target.serviceName).toBe(plan.serviceName);
    expect(target.serviceLabel).toBe(plan.serviceLabel);
    expect(target.definitionPath).toBe(
      resolveServiceDefinitionPath({
        platform: plan.platform,
        serviceName: plan.serviceName,
        serviceLabel: plan.serviceLabel,
      }),
    );
  });

  it("builds a service target from IMP_CONFIG_PATH when --config is omitted", () => {
    const env = {
      IMP_CONFIG_PATH: "/tmp/from-env.json",
    };

    const target = resolveServiceTarget({ env });

    expect(target.configPath).toBe(env.IMP_CONFIG_PATH);
  });
});

describe("createRuntimeTransportFactory", () => {
  it("creates transports via the centralized transport registry", () => {
    const transport = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    createTransportMock.mockReturnValueOnce(transport);
    const botConfig = {
      id: "private-telegram",
      type: "telegram" as const,
      token: "123:abc",
      allowedUserIds: ["7"],
      defaultAgentId: "default",
      skillCatalog: [],
      skillIssues: [],
      paths: {
        dataRoot: "/tmp",
        botRoot: "/tmp/bot",
        conversationsDir: "/tmp/bot/conversations",
        logsDir: "/tmp/bot/logs",
        logFilePath: "/tmp/bot/logs/daemon.log",
        runtimeDir: "/tmp/bot/runtime",
        runtimeStatePath: "/tmp/bot/runtime/daemon.json",
      },
    };
    const logger = {
      debug: vi.fn(async () => undefined),
      info: vi.fn(async () => undefined),
      error: vi.fn(async () => undefined),
    };

    const resolved = createRuntimeTransportFactory(botConfig, logger);

    expect(resolved).toBe(transport);
    expect(createTransportMock).toHaveBeenCalledWith(botConfig.type, botConfig, logger);
  });
});

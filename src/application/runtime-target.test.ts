import { describe, expect, it, vi } from "vitest";
import { createDeliveryRouter } from "../transports/delivery-router.js";
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
  it("resolves service config path by precedence", () => {
    expect(resolveServiceConfigPath({
      cliConfigPath: "/tmp/from-cli.json",
      env: {
        IMP_CONFIG_PATH: "/tmp/from-env.json",
      },
    })).toBe("/tmp/from-cli.json");

    expect(resolveServiceConfigPath({
      env: {
        IMP_CONFIG_PATH: "/tmp/from-env.json",
      },
    })).toBe("/tmp/from-env.json");

    const env = {
      XDG_CONFIG_HOME: "/tmp/custom-config-home",
    };
    expect(resolveServiceConfigPath({ env })).toBe(getDefaultUserConfigPath(env));
  });
});

describe("resolveServiceTarget", () => {
  it("builds service targets from resolved config paths", () => {
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

    const env = {
      IMP_CONFIG_PATH: "/tmp/from-env.json",
    };
    expect(resolveServiceTarget({ env }).configPath).toBe(env.IMP_CONFIG_PATH);
  });
});

describe("createRuntimeTransportFactory", () => {
  it("creates transports via the centralized transport registry", () => {
    const transport = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    createTransportMock.mockReturnValueOnce(transport);
    const endpointConfig = {
      id: "private-telegram",
      type: "telegram" as const,
      token: "123:abc",
      allowedUserIds: ["7"],
      defaultAgentId: "default",
      paths: {
        dataRoot: "/tmp",
        sessionsDir: "/tmp/sessions",
        bindingsDir: "/tmp/bindings",
        logsDir: "/tmp/logs",
        logFilePath: "/tmp/logs/endpoints.log",
        runtimeDir: "/tmp/runtime/endpoints",
        runtimeStatePath: "/tmp/runtime/endpoints/private-telegram.json",
      },
    };
    const logger = {
      debug: vi.fn(async () => undefined),
      info: vi.fn(async () => undefined),
      error: vi.fn(async () => undefined),
    };

    const context = {
      deliveryRouter: createDeliveryRouter(),
    };
    const resolved = createRuntimeTransportFactory(endpointConfig, logger, context);

    expect(resolved).toBe(transport);
    expect(createTransportMock).toHaveBeenCalledWith(endpointConfig.type, endpointConfig, logger, context);
  });
});

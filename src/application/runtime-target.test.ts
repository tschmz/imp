import { describe, expect, it } from "vitest";
import { getDefaultUserConfigPath } from "../config/discover-config-path.js";
import { createServiceInstallPlan } from "../service/install-plan.js";
import { resolveServiceDefinitionPath } from "../service/install-service.js";
import { resolveServiceConfigPath, resolveServiceTarget } from "./runtime-target.js";

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

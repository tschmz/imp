import { describe, expect, it, vi } from "vitest";
import { createServiceUseCases } from "./service-use-cases.js";

describe("createServiceUseCases", () => {
  it("resolves service target for start using explicit --config", async () => {
    const resolveServiceTarget = vi.fn(() => ({
      configPath: "/tmp/config.json",
      platform: "linux-systemd-user" as const,
      definitionPath: "/tmp/imp.service",
      serviceName: "imp",
      serviceLabel: "dev.imp",
    }));
    const startService = vi.fn(async () => undefined);
    const writeOutput = vi.fn();
    const useCases = createServiceUseCases({
      resolveServiceTarget,
      startService,
      writeOutput,
    });

    await useCases.startService({ configPath: "/tmp/config.json" });

    expect(resolveServiceTarget).toHaveBeenCalledWith({ cliConfigPath: "/tmp/config.json" });
    expect(startService).toHaveBeenCalledWith({
      configPath: "/tmp/config.json",
      platform: "linux-systemd-user",
      definitionPath: "/tmp/imp.service",
      serviceName: "imp",
      serviceLabel: "dev.imp",
    });
    expect(writeOutput).toHaveBeenCalledWith("Started linux-systemd-user service imp");
  });

  it("prints status output only when non-empty", async () => {
    const resolveServiceTarget = vi.fn(() => ({
      configPath: "/tmp/from-env.json",
      platform: "linux-systemd-user" as const,
      definitionPath: "/tmp/imp.service",
      serviceName: "imp",
      serviceLabel: "dev.imp",
    }));
    const statusService = vi
      .fn<(...args: unknown[]) => Promise<string>>()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("active");
    const writeOutput = vi.fn();
    const useCases = createServiceUseCases({
      resolveServiceTarget,
      statusService,
      writeOutput,
    });

    await useCases.statusService({});
    await useCases.statusService({});

    expect(resolveServiceTarget).toHaveBeenCalledWith({ cliConfigPath: undefined });
    expect(statusService).toHaveBeenCalledTimes(2);
    expect(writeOutput).toHaveBeenCalledTimes(1);
    expect(writeOutput).toHaveBeenCalledWith("active");
  });
});

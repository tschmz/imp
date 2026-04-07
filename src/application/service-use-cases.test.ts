import { describe, expect, it, vi } from "vitest";
import { ServiceOperationError } from "../service/service-error.js";
import { createServiceUseCases } from "./service-use-cases.js";

describe("createServiceUseCases", () => {
  it("forwards the CLI force flag to service installation", async () => {
    const discoverConfigPath = vi.fn(async () => ({
      configPath: "/tmp/config.json",
      checkedPaths: ["/tmp/config.json"],
    }));
    const createServiceInstallPlan = vi.fn(() => ({
      platform: "linux-systemd-user" as const,
      serviceName: "imp",
      serviceLabel: "dev.imp",
      configPath: "/tmp/config.json",
      workingDirectory: "/tmp",
      command: "/usr/bin/node",
      args: ["/app/dist/main.js", "start", "--config", "/tmp/config.json"],
      environmentPath: "/tmp/service.env",
    }));
    const resolveServiceDefinitionPath = vi.fn(() => "/tmp/imp.service");
    const assertServiceInstallCanProceed = vi.fn(async () => "/tmp/imp.service");
    const installService = vi.fn(async ({ force }: { force?: boolean }) => ({
      operation: {
        operation: "install" as const,
        platform: "linux-systemd-user" as const,
        serviceName: "imp",
        definitionPath: "/tmp/imp.service",
      },
      plan: createServiceInstallPlan(),
      ...(force !== undefined ? { environmentPath: "/tmp/service.env" } : {}),
    }));
    const writeOutput = vi.fn();
    const useCases = createServiceUseCases({
      discoverConfigPath,
      createServiceInstallPlan,
      resolveServiceDefinitionPath,
      assertServiceInstallCanProceed,
      installService,
      writeOutput,
    });

    await useCases.installService({ configPath: "/tmp/config.json", dryRun: false, force: false });
    await useCases.installService({ configPath: "/tmp/config.json", dryRun: false, force: true });

    expect(installService).toHaveBeenNthCalledWith(1, { configPath: "/tmp/config.json", force: false });
    expect(installService).toHaveBeenNthCalledWith(2, { configPath: "/tmp/config.json", force: true });
  });

  it("orchestrates start with adapter-agnostic service result", async () => {
    const resolveServiceConfigPath = vi.fn(() => "/tmp/config.json");
    const startService = vi.fn(async () => ({
      operation: "start" as const,
      platform: "linux-systemd-user" as const,
      serviceName: "imp",
      definitionPath: "/tmp/imp.service",
    }));
    const writeOutput = vi.fn();
    const useCases = createServiceUseCases({
      resolveServiceConfigPath,
      startService,
      writeOutput,
    });

    await useCases.startService({ configPath: "/tmp/config.json" });

    expect(resolveServiceConfigPath).toHaveBeenCalledWith({ cliConfigPath: "/tmp/config.json" });
    expect(startService).toHaveBeenCalledWith({ configPath: "/tmp/config.json" });
    expect(writeOutput).toHaveBeenCalledWith("Started linux-systemd-user service imp");
  });

  it("prints status output only when non-empty", async () => {
    const resolveServiceConfigPath = vi.fn(() => "/tmp/from-env.json");
    const statusService = vi
      .fn<(...args: unknown[]) => Promise<{ statusOutput?: string; operation: "status"; platform: "linux-systemd-user"; serviceName: "imp"; definitionPath: "/tmp/imp.service" }>>()
      .mockResolvedValueOnce({ operation: "status", platform: "linux-systemd-user", serviceName: "imp", definitionPath: "/tmp/imp.service", statusOutput: "" })
      .mockResolvedValueOnce({ operation: "status", platform: "linux-systemd-user", serviceName: "imp", definitionPath: "/tmp/imp.service", statusOutput: "active" });
    const writeOutput = vi.fn();
    const useCases = createServiceUseCases({
      resolveServiceConfigPath,
      statusService,
      writeOutput,
    });

    await useCases.statusService({});
    await useCases.statusService({});

    expect(resolveServiceConfigPath).toHaveBeenCalledWith({ cliConfigPath: undefined });
    expect(statusService).toHaveBeenCalledTimes(2);
    expect(writeOutput).toHaveBeenCalledTimes(1);
    expect(writeOutput).toHaveBeenCalledWith("active");
  });

  it("maps service errors to consistent cli messages", async () => {
    const useCases = createServiceUseCases({
      resolveServiceConfigPath: () => "/tmp/config.json",
      stopService: vi.fn(async () => {
        throw new ServiceOperationError("permission_denied", "No permission");
      }),
    });

    await expect(useCases.stopService({})).rejects.toThrow("[permission_denied] No permission");
  });
});

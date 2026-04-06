import { describe, expect, it, vi } from "vitest";
import { ServiceOperationError } from "../service/service-error.js";
import { createServiceUseCases } from "./service-use-cases.js";

describe("createServiceUseCases", () => {
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

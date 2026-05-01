import type { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { createCli, type CliDependencies, parseIntegerOption, parsePositiveIntegerOption } from "./create-cli.js";

describe("createCli", () => {
  it("exposes the documented help surface", () => {
    const cli = createCli(createDependencies());
    const daemonCommand = findCommand(cli, "daemon");
    const configCommand = findCommand(cli, "config");
    const skillCommand = findCommand(cli, "skill");
    const serviceCommand = findCommand(cli, "service");
    const backupCommand = findCommand(cli, "backup");
    const pluginCommand = findCommand(cli, "plugin");

    expect(cli.helpInformation()).toContain("Usage: imp");
    expect(cli.helpInformation()).toContain("daemon");
    expect(cli.helpInformation()).toContain("chat");
    expect(cli.helpInformation()).toContain("logs");
    expect(cli.helpInformation()).toContain("config");
    expect(cli.helpInformation()).toContain("init");
    expect(cli.helpInformation()).toContain("skill");
    expect(cli.helpInformation()).toContain("backup");
    expect(cli.helpInformation()).toContain("plugin");
    expect(cli.helpInformation()).toContain("service");
    expect(cli.helpInformation()).toContain("--version");

    expect(findCommand(daemonCommand, "run").helpInformation()).toContain("Usage: imp daemon run");
    expect(findCommand(daemonCommand, "run").helpInformation()).toContain("--config <path>");
    expect(findCommand(cli, "chat").helpInformation()).toContain("--endpoint <endpoint-id>");

    const logsHelp = findCommand(cli, "logs").helpInformation();
    expect(logsHelp).toContain("--endpoint <endpoint-id>");
    expect(logsHelp).toContain("--follow");
    expect(logsHelp).toContain("--lines <count>");

    expect(findCommand(cli, "init").helpInformation()).toContain("--config <path>");
    expect(findCommand(skillCommand, "sync").helpInformation()).toContain("Usage: imp skill sync");
    expect(findCommand(skillCommand, "sync").helpInformation()).toContain("--config <path>");

    expect(findCommand(configCommand, "validate").helpInformation()).toContain("Usage: imp config validate");
    expect(findCommand(configCommand, "validate").helpInformation()).toContain("--config <path>");
    expect(findCommand(configCommand, "validate").helpInformation()).toContain("--preflight");
    expect(findCommand(configCommand, "schema").helpInformation()).toContain("Usage: imp config schema");

    const configGetHelp = findCommand(configCommand, "get").helpInformation();
    expect(configGetHelp).toContain("Usage: imp config get");
    expect(configGetHelp).toContain("<key-path>");
    expect(configGetHelp).toContain("--config <path>");

    const configSetHelp = findCommand(configCommand, "set").helpInformation();
    expect(configSetHelp).toContain("Usage: imp config set");
    expect(configSetHelp).toContain("<key-path>");
    expect(configSetHelp).toContain("<value>");
    expect(configSetHelp).toContain("--config <path>");

    expect(findCommand(configCommand, "reload").helpInformation()).toContain("Usage: imp config reload");

    expect(backupCommand.helpInformation()).toContain("inspect");
    expect(findCommand(backupCommand, "create").helpInformation()).toContain("Usage: imp backup create");
    expect(findCommand(backupCommand, "create").helpInformation()).toContain("--output <archive>");
    expect(findCommand(backupCommand, "create").helpInformation()).toContain("--only <scopes>");
    expect(findCommand(backupCommand, "create").helpInformation()).toContain("--force");
    expect(findCommand(backupCommand, "inspect").helpInformation()).toContain("Usage: imp backup inspect");
    expect(findCommand(backupCommand, "inspect").helpInformation()).toContain("<archive>");
    const restoreHelp = findCommand(backupCommand, "restore").helpInformation();
    expect(restoreHelp).toContain("Usage: imp backup restore");
    expect(restoreHelp).toContain("<archive>");
    expect(restoreHelp).toContain("--config <path>");
    expect(restoreHelp).toContain("--data-root <path>");
    expect(restoreHelp).toContain("--only <scopes>");
    expect(restoreHelp).toContain("--force");

    expect(findCommand(pluginCommand, "list").helpInformation()).toContain("Usage: imp plugin list");
    expect(findCommand(pluginCommand, "list").helpInformation()).toContain("--root <path>");
    expect(findCommand(pluginCommand, "list").helpInformation()).toContain("--config <path>");
    expect(findCommand(pluginCommand, "inspect").helpInformation()).toContain("Usage: imp plugin inspect");
    expect(findCommand(pluginCommand, "inspect").helpInformation()).toContain("<plugin>");
    expect(findCommand(pluginCommand, "inspect").helpInformation()).toContain("--root <path>");
    expect(findCommand(pluginCommand, "inspect").helpInformation()).toContain("--config <path>");
    expect(findCommand(pluginCommand, "check").helpInformation()).toContain("Usage: imp plugin check");
    expect(findCommand(pluginCommand, "check").helpInformation()).toContain("--config <path>");
    expect(findCommand(pluginCommand, "status").helpInformation()).toContain("Usage: imp plugin status");
    expect(findCommand(pluginCommand, "status").helpInformation()).toContain("--config <path>");
    expect(findCommand(pluginCommand, "install").helpInformation()).toContain("Usage: imp plugin install");
    expect(findCommand(pluginCommand, "install").helpInformation()).toContain("<plugin>");
    expect(findCommand(pluginCommand, "install").helpInformation()).toContain("--config <path>");
    expect(findCommand(pluginCommand, "install").helpInformation()).toContain("--root <path>");
    expect(findCommand(pluginCommand, "install").helpInformation()).toContain("--no-services");
    expect(findCommand(pluginCommand, "install").helpInformation()).toContain("--services-only");
    expect(findCommand(pluginCommand, "install").helpInformation()).toContain("--force");
    expect(pluginCommand.helpInformation()).not.toContain("update [options]");

    const serviceInstallHelp = findCommand(serviceCommand, "install").helpInformation();
    expect(serviceInstallHelp).toContain("Usage: imp service install");
    expect(serviceInstallHelp).toContain("--config <path>");
    expect(serviceInstallHelp).toContain("--force");
    expect(serviceInstallHelp).toContain("--dry-run");

    expect(findCommand(serviceCommand, "uninstall").helpInformation()).toContain("Usage: imp service uninstall");
    expect(findCommand(serviceCommand, "start").helpInformation()).toContain("Usage: imp service start");
    expect(findCommand(serviceCommand, "stop").helpInformation()).toContain("Usage: imp service stop");
    expect(findCommand(serviceCommand, "restart").helpInformation()).toContain("Usage: imp service restart");
    expect(findCommand(serviceCommand, "status").helpInformation()).toContain("Usage: imp service status");
  });

  it("parses representative commands into dependency calls", async () => {
    const dependencies = createDependencies();
    const cli = createCli(dependencies);

    await cli.parseAsync(["node", "imp", "daemon", "run", "--config", "/tmp/imp.json"]);
    await cli.parseAsync(["node", "imp", "logs", "--endpoint", "ops", "--follow", "--lines", "2", "--config", "/tmp/imp.json"]);
    await cli.parseAsync(["node", "imp", "config", "schema"]);
    await cli.parseAsync(["node", "imp", "config", "set", "--config", "/tmp/imp.json", "endpoints.0.enabled", "false"]);
    await cli.parseAsync(["node", "imp", "chat", "--endpoint", "local-cli", "--config", "/tmp/imp.json"]);
    await cli.parseAsync(["node", "imp", "backup", "inspect", "/tmp/backup.tar"]);
    await cli.parseAsync(["node", "imp", "backup", "restore", "/tmp/backup.tar", "--config", "/tmp/imp.json", "--data-root", "/tmp/state", "--only", "agents", "--force"]);
    await cli.parseAsync(["node", "imp", "plugin", "list", "--config", "/tmp/imp.json", "--root", "/tmp/plugins"]);
    await cli.parseAsync(["node", "imp", "plugin", "inspect", "imp-voice", "--config", "/tmp/imp.json", "--root", "/tmp/plugins"]);
    await cli.parseAsync(["node", "imp", "plugin", "check", "imp-voice", "--config", "/tmp/imp.json"]);
    await cli.parseAsync(["node", "imp", "plugin", "status", "imp-voice", "--config", "/tmp/imp.json"]);
    await cli.parseAsync(["node", "imp", "plugin", "install", "imp-voice", "--config", "/tmp/imp.json", "--root", "/tmp/plugins"]);
    await cli.parseAsync([
      "node",
      "imp",
      "plugin",
      "install",
      "imp-voice",
      "--config",
      "/tmp/imp.json",
      "--root",
      "/tmp/plugins",
      "--no-services",
      "--services-only",
      "--force",
    ]);
    await cli.parseAsync(["node", "imp", "service", "install", "--config", "/tmp/imp.json", "--dry-run"]);
    await cli.parseAsync(["node", "imp", "init", "--config", "/tmp/imp.json"]);
    await cli.parseAsync(["node", "imp", "skill", "sync", "--config", "/tmp/imp.json"]);

    expect(dependencies.startDaemon).toHaveBeenCalledWith({
      configPath: "/tmp/imp.json",
    });
    expect(dependencies.viewLogs).toHaveBeenCalledWith({
      endpointId: "ops",
      configPath: "/tmp/imp.json",
      follow: true,
      lines: 2,
    });
    expect(dependencies.showConfigSchema).toHaveBeenCalledWith();
    expect(dependencies.setConfigValue).toHaveBeenCalledWith({
      configPath: "/tmp/imp.json",
      keyPath: "endpoints.0.enabled",
      value: "false",
    });
    expect(dependencies.startChat).toHaveBeenCalledWith({
      configPath: "/tmp/imp.json",
      endpointId: "local-cli",
    });
    expect(dependencies.inspectBackup).toHaveBeenCalledWith({
      inputPath: "/tmp/backup.tar",
    });
    expect(dependencies.restoreBackup).toHaveBeenCalledWith({
      configPath: "/tmp/imp.json",
      dataRoot: "/tmp/state",
      force: true,
      inputPath: "/tmp/backup.tar",
      only: "agents",
    });
    expect(dependencies.listPlugins).toHaveBeenCalledWith({
      configPath: "/tmp/imp.json",
      root: "/tmp/plugins",
    });
    expect(dependencies.inspectPlugin).toHaveBeenCalledWith({
      configPath: "/tmp/imp.json",
      root: "/tmp/plugins",
      id: "imp-voice",
    });
    expect(dependencies.checkPlugin).toHaveBeenCalledWith({
      configPath: "/tmp/imp.json",
      id: "imp-voice",
    });
    expect(dependencies.statusPlugin).toHaveBeenCalledWith({
      configPath: "/tmp/imp.json",
      id: "imp-voice",
    });
    expect(dependencies.installPlugin).toHaveBeenCalledWith({
      configPath: "/tmp/imp.json",
      root: "/tmp/plugins",
      id: "imp-voice",
      autoStartServices: true,
      servicesOnly: false,
      force: false,
    });
    expect(dependencies.installPlugin).toHaveBeenCalledWith({
      configPath: "/tmp/imp.json",
      root: "/tmp/plugins",
      id: "imp-voice",
      autoStartServices: false,
      servicesOnly: true,
      force: true,
    });
    expect(dependencies.installService).toHaveBeenCalledWith({
      configPath: "/tmp/imp.json",
      dryRun: true,
      force: false,
    });
    expect(dependencies.initConfig).toHaveBeenCalledWith({
      configPath: "/tmp/imp.json",
      force: false,
    });
    expect(dependencies.syncManagedSkills).toHaveBeenCalledWith({
      configPath: "/tmp/imp.json",
    });
  });

  it("keeps a stable top-level command surface", () => {
    const cli = createCli(createDependencies());

    expect(cli.commands.map((command) => command.name())).toMatchInlineSnapshot(`
      [
        "daemon",
        "chat",
        "logs",
        "init",
        "config",
        "skill",
        "backup",
        "plugin",
        "service",
      ]
    `);
  });

  it("rejects invalid logs line counts strictly", () => {
    for (const value of ["2abc", "abc", "1.5", "", "   "]) {
      expect(() => parseIntegerOption(value)).toThrow("Expected an integer.");
    }
  });

  it("rejects non-positive logs line counts at CLI parse time", () => {
    for (const value of ["0", "-1"]) {
      expect(() => parsePositiveIntegerOption(value)).toThrow("Expected a positive integer.");
    }
  });

  it("rejects non-positive --lines values before invoking the logs use case", async () => {
    const dependencies = createDependencies();
    const cli = createCli(dependencies);
    const logsCommand = findCommand(cli, "logs");
    logsCommand.exitOverride();
    logsCommand.configureOutput({
      writeErr: vi.fn(),
    });

    await expect(cli.parseAsync(["node", "imp", "logs", "--lines", "-1"])).rejects.toThrow(
      "Expected a positive integer.",
    );
    expect(dependencies.viewLogs).not.toHaveBeenCalled();
  });
});

function findCommand(command: Command, name: string): Command {
  const found = command.commands.find((entry) => entry.name() === name);

  if (!found) {
    throw new Error(`Command not found: ${name}`);
  }

  return found;
}

function createDependencies(): CliDependencies {
  return {
    startDaemon: vi.fn(async () => undefined),
    startChat: vi.fn(async () => undefined),
    viewLogs: vi.fn(async () => undefined),
    validateConfig: vi.fn(async () => undefined),
    showConfigSchema: vi.fn(async () => undefined),
    reloadConfig: vi.fn(async () => undefined),
    getConfigValue: vi.fn(async () => undefined),
    setConfigValue: vi.fn(async () => undefined),
    initConfig: vi.fn(async () => undefined),
    syncManagedSkills: vi.fn(async () => undefined),
    createBackup: vi.fn(async () => undefined),
    inspectBackup: vi.fn(async () => undefined),
    restoreBackup: vi.fn(async () => undefined),
    listPlugins: vi.fn(async () => undefined),
    inspectPlugin: vi.fn(async () => undefined),
    checkPlugin: vi.fn(async () => undefined),
    statusPlugin: vi.fn(async () => undefined),
    installPlugin: vi.fn(async () => undefined),
    installService: vi.fn(async () => undefined),
    uninstallService: vi.fn(async () => undefined),
    startService: vi.fn(async () => undefined),
    stopService: vi.fn(async () => undefined),
    restartService: vi.fn(async () => undefined),
    statusService: vi.fn(async () => undefined),
  };
}

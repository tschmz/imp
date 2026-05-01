import { describe, expect, it, vi } from "vitest";
import { createCli, type CliDependencies } from "./create-cli.js";
import { completeCliWords, createBashCompletionScript } from "./completion.js";

describe("completion", () => {
  it("completes the top-level command surface", () => {
    const cli = createCli(createDependencies());
    const completions = completeCliWords(cli, [""]);

    expect(completions).toContain("daemon");
    expect(completions).toContain("plugin");
    expect(completions).toContain("completion");
    expect(completions).not.toContain("complete");
  });

  it("completes plugin subcommands without removed commands", () => {
    const cli = createCli(createDependencies());

    expect(completeCliWords(cli, ["plugin", ""])).toEqual(
      expect.arrayContaining(["list", "inspect", "check", "status", "install"]),
    );
    expect(completeCliWords(cli, ["plugin", ""])).not.toContain("update");
    expect(completeCliWords(cli, ["plugin", "i"])).toEqual(["inspect", "install"]);
  });

  it("completes command options", () => {
    const cli = createCli(createDependencies());
    const completions = completeCliWords(cli, ["logs", "--"]);

    expect(completions).toEqual(expect.arrayContaining(["--config", "--endpoint", "--follow", "--help", "--lines"]));
  });

  it("leaves free-form option values to the shell", () => {
    const cli = createCli(createDependencies());

    expect(completeCliWords(cli, ["logs", "--lines", ""])).toEqual([]);
  });

  it("prints a bash completion script wired to the hidden resolver", () => {
    const script = createBashCompletionScript();

    expect(script).toContain('"$command" completion complete --');
    expect(script).toContain("complete -o default -F _imp_completion imp");
  });
});

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

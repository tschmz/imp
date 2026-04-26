import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPluginUseCases,
  getPluginPackageStoreRoot,
  getPluginSearchRoots,
  parseNpmPackageName,
  tryParseNpmPackageName,
} from "./plugin-use-cases.js";
import type { AppConfig } from "../config/types.js";

describe("plugin use cases", () => {
  it("lists plugins from an explicit root", async () => {
    const root = await createPluginRoot();
    await writeManifest(root, "imp-voice", {
      schemaVersion: 1,
      id: "imp-voice",
      name: "imp Voice",
      version: "0.1.0",
      description: "Local voice frontend.",
    });
    const writeOutput = vi.fn();
    const useCases = createPluginUseCases({ writeOutput });

    await useCases.listPlugins({ root });

    expect(writeOutput).toHaveBeenCalledWith("imp-voice\timp Voice 0.1.0 - Local voice frontend.");
  });

  it("inspects file endpoint and service defaults", async () => {
    const root = await createPluginRoot();
    await writeManifest(root, "imp-voice", {
      schemaVersion: 1,
      id: "imp-voice",
      name: "imp Voice",
      version: "0.1.0",
      capabilities: ["voice", "service"],
      endpoints: [
        {
          id: "audio-ingress",
          response: {
            type: "outbox",
            replyChannel: {
              kind: "audio",
            },
          },
        },
      ],
      services: [
        {
          id: "speaker",
          command: "node",
          args: ["dist/speaker.js"],
        },
      ],
      mcpServers: [
        {
          id: "voice-tools",
          command: "node",
          args: ["dist/mcp-server.js"],
        },
      ],
    });
    const writeOutput = vi.fn();
    const useCases = createPluginUseCases({ writeOutput });

    await useCases.inspectPlugin({ root, id: "imp-voice" });

    expect(writeOutput).toHaveBeenCalledWith(
      [
        "imp Voice (imp-voice)",
        "Version: 0.1.0",
        `Root: ${join(root, "imp-voice")}`,
        `Manifest: ${join(root, "imp-voice", "plugin.json")}`,
        "Capabilities: voice, service",
        "",
        "Endpoints:",
        "- audio-ingress: response=outbox",
        "",
        "Services:",
        "- speaker: node dist/speaker.js",
        "",
        "MCP servers:",
        "- voice-tools: node dist/mcp-server.js",
      ].join("\n"),
    );
  });

  it("uses IMP_PLUGIN_PATH as the default local plugin roots", () => {
    expect(
      getPluginSearchRoots(
        {},
        {
          IMP_PLUGIN_PATH: ["/opt/imp/plugins", "/home/me/plugins"].join(delimiter),
        },
      ),
    ).toEqual(["/opt/imp/plugins", "/home/me/plugins"]);
  });

  it("does not scan an implicit plugin root by default", () => {
    expect(getPluginSearchRoots({}, {})).toEqual([]);
  });

  it("resolves package store roots below the configured data root", () => {
    expect(getPluginPackageStoreRoot({ ...createConfig(), paths: { dataRoot: "state" } }, "/tmp/imp/config.json")).toBe(
      "/tmp/imp/state/plugins/npm",
    );
  });

  it("parses npm package names from install specs", () => {
    expect(parseNpmPackageName("@tschmz/imp-voice")).toBe("@tschmz/imp-voice");
    expect(parseNpmPackageName("@tschmz/imp-voice@0.1.0")).toBe("@tschmz/imp-voice");
    expect(parseNpmPackageName("imp-voice@latest")).toBe("imp-voice");
    expect(parseNpmPackageName("npm:@tschmz/imp-voice")).toBe("@tschmz/imp-voice");
    expect(parseNpmPackageName("imp-voice-local@npm:@tschmz/imp-voice@0.1.0")).toBe("imp-voice-local");
    expect(tryParseNpmPackageName("./tschmz-imp-voice-0.1.0.tgz")).toBeUndefined();
    expect(tryParseNpmPackageName("github:tschmz/imp-voice")).toBeUndefined();
  });

  it("installs plugin manifests into an existing config", async () => {
    const root = await createPluginRoot();
    const configPath = join(root, "config.json");
    await writeManifest(root, "imp-voice", {
      schemaVersion: 1,
      id: "imp-voice",
      name: "imp Voice",
      version: "0.1.0",
      endpoints: [
        {
          id: "audio-ingress",
          ingress: {
            pollIntervalMs: 500,
          },
          response: {
            type: "outbox",
            replyChannel: {
              kind: "audio",
            },
          },
        },
      ],
      mcpServers: [
        {
          id: "voice-control",
          command: "node",
          args: ["dist/mcp-server.js"],
          cwd: ".",
          env: {
            IMP_CONFIG_PATH: "{{config.path}}",
            IMP_DATA_ROOT: "{{paths.dataRoot}}",
            IMP_AGENT_ID: "{{agent.id}}",
          },
        },
      ],
    });
    await writeFile(configPath, `${JSON.stringify(createConfig(), null, 2)}\n`, "utf8");
    const writeOutput = vi.fn();
    const useCases = createPluginUseCases({ writeOutput });

    await useCases.installPlugin({
      root,
      configPath,
      id: "imp-voice",
    });

    const updated = JSON.parse(await readConfig(configPath)) as AppConfig;
    expect(updated.plugins).toEqual([
      {
        id: "imp-voice",
        enabled: true,
        package: {
          path: join(root, "imp-voice"),
          source: {
            version: "0.1.0",
            manifestHash: expect.stringMatching(/^sha256:/),
          },
        },
      },
    ]);
    expect(updated.tools).toEqual({
      mcp: {
        servers: [
          {
            id: "voice-control",
            command: process.execPath,
            args: ["dist/mcp-server.js"],
            cwd: join(root, "imp-voice"),
            env: {
              IMP_CONFIG_PATH: configPath,
              IMP_DATA_ROOT: "/tmp/imp",
              IMP_AGENT_ID: "{{agent.id}}",
            },
          },
        ],
      },
    });
    expect(updated.endpoints).toEqual([
      {
        id: "audio-ingress",
        type: "file",
        enabled: true,
        pluginId: "imp-voice",
        ingress: {
          pollIntervalMs: 500,
        },
        response: {
          type: "outbox",
          replyChannel: {
            kind: "audio",
          },
        },
      },
    ]);
    expect(writeOutput).toHaveBeenCalledWith(`Installed plugin "imp-voice" into ${configPath}`);
    expect(writeOutput).toHaveBeenCalledWith("Added endpoints: audio-ingress");
    expect(writeOutput).toHaveBeenCalledWith("Added MCP servers: voice-control");
  });

  it("checks configured plugin health", async () => {
    const root = await createPluginRoot();
    const configPath = join(root, "config.json");
    const dataRoot = join(root, "state");
    const pluginRoot = join(root, "imp-voice");
    await writeManifest(root, "imp-voice", {
      schemaVersion: 1,
      id: "imp-voice",
      name: "imp Voice",
      version: "0.1.0",
      endpoints: [
        {
          id: "audio-ingress",
          response: {
            type: "none",
          },
        },
      ],
    });
    await mkdir(join(dataRoot, "runtime", "plugins", "imp-voice", "endpoints", "audio-ingress"), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          ...createConfig(),
          paths: { dataRoot },
          plugins: [
            {
              id: "imp-voice",
              enabled: true,
              package: {
                path: pluginRoot,
              },
            },
          ],
          endpoints: [
            {
              id: "audio-ingress",
              type: "file",
              enabled: true,
              pluginId: "imp-voice",
              response: {
                type: "none",
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const writeOutput = vi.fn();
    const useCases = createPluginUseCases({ writeOutput });

    await useCases.doctorPlugin({ configPath, id: "imp-voice" });
    await useCases.statusPlugin({ configPath, id: "imp-voice" });

    expect(writeOutput).toHaveBeenCalledWith(
      [
        "Plugin imp-voice: ok",
        "- OK config entry: enabled",
        `- OK package path: ${pluginRoot}`,
        "- OK manifest: id=imp-voice version=0.1.0",
        "- OK endpoint audio-ingress: configured",
        `- OK runtime audio-ingress: ${join(dataRoot, "runtime", "plugins", "imp-voice", "endpoints", "audio-ingress")}`,
      ].join("\n"),
    );
    expect(writeOutput).toHaveBeenCalledWith("Plugin imp-voice: ok");
  });

  it("installs plugin packages below paths.dataRoot when no local manifest matches", async () => {
    const root = await createPluginRoot();
    const configDir = join(root, "config");
    const configPath = join(configDir, "config.json");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify({ ...createConfig(), paths: { dataRoot: "state" } }, null, 2)}\n`,
      "utf8",
    );
    const packageInstalls: Array<{ packageSpec: string; packageName: string; storeRoot: string }> = [];
    const writeOutput = vi.fn();
    const useCases = createPluginUseCases({
      writeOutput,
      async installPackage({ packageSpec, packageName, storeRoot }) {
        if (!packageName) {
          throw new Error("Expected package name.");
        }
        packageInstalls.push({ packageSpec, packageName, storeRoot });
        const packageRoot = join(storeRoot, "node_modules", ...packageName.split("/"));
        await mkdir(packageRoot, { recursive: true });
        await writeFile(
          join(packageRoot, "plugin.json"),
          `${JSON.stringify(
            {
              schemaVersion: 1,
              id: "imp-voice",
              name: "imp Voice",
              version: "0.1.0",
              endpoints: [
                {
                  id: "audio-ingress",
                  response: {
                    type: "none",
                  },
                },
              ],
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
        return { packageRoot };
      },
    });

    await useCases.installPlugin({
      configPath,
      id: "@tschmz/imp-voice@0.1.0",
      autoStartServices: false,
    });

    const packageStoreRoot = join(configDir, "state", "plugins", "npm");
    const packageRoot = join(packageStoreRoot, "node_modules", "@tschmz", "imp-voice");
    const updated = JSON.parse(await readConfig(configPath)) as AppConfig;
    expect(packageInstalls).toEqual([
      {
        packageSpec: "@tschmz/imp-voice@0.1.0",
        packageName: "@tschmz/imp-voice",
        storeRoot: packageStoreRoot,
      },
    ]);
    expect(updated.plugins).toEqual([
      {
        id: "imp-voice",
        enabled: true,
        package: {
          path: packageRoot,
          source: {
            version: "0.1.0",
            manifestHash: expect.stringMatching(/^sha256:/),
          },
        },
      },
    ]);
    expect(writeOutput).toHaveBeenCalledWith(
      `Installed plugin package "@tschmz/imp-voice@0.1.0" into ${packageStoreRoot}`,
    );
    expect(writeOutput).toHaveBeenCalledWith(`Installed plugin "imp-voice" into ${configPath}`);
  });

  it("installs and starts auto-start plugin services", async () => {
    const root = await createPluginRoot();
    const configPath = join(root, "config.json");
    const dataRoot = join(root, "state");
    const calls: Array<{ command: string; args: string[] }> = [];
    const setupCalls: Array<{ command: string; args: string[] }> = [];
    await writeManifest(root, "imp-voice", {
      schemaVersion: 1,
      id: "imp-voice",
      name: "imp Voice",
      version: "0.1.0",
      endpoints: [
        {
          id: "audio-ingress",
          response: {
            type: "outbox",
            replyChannel: {
              kind: "audio",
            },
          },
        },
      ],
      services: [
        {
          id: "in",
          autoStart: true,
          command: "bash",
          cwd: ".",
          args: ["bin/wake-phrase", "--config", "config/wake-phrase.toml"],
          env: {
            IMP_VOICE_RUNTIME_DIR: "{{endpoint.audio-ingress.runtimeDir}}",
            IMP_VOICE_RECORDINGS_DIR: "{{paths.dataRoot}}/runtime/plugins/{{plugin.id}}/recordings",
            IMP_VOICE_PYTHON: "{{setup.python.venvPython}}",
            OPENAI_API_KEY: "required",
          },
        },
        {
          id: "out",
          autoStart: true,
          command: "node",
          cwd: ".",
          args: ["bin/speaker-outbox.mjs", "--config", "config/default.json"],
          env: {
            IMP_VOICE_RUNTIME_DIR: "{{endpoint.audio-ingress.runtimeDir}}",
            OPENAI_API_KEY: "required",
          },
        },
        {
          id: "text-ingress",
          autoStart: false,
          command: "node",
          args: ["bin/text-ingress.mjs"],
        },
      ],
      setup: {
        python: {
          requirements: "requirements.txt",
        },
      },
    });
    await writeFile(configPath, `${JSON.stringify({ ...createConfig(), paths: { dataRoot } }, null, 2)}\n`, "utf8");
    const writeOutput = vi.fn();
    const useCases = createPluginUseCases({
      writeOutput,
      env: {
        OPENAI_API_KEY: "sk-test",
      },
      platform: "linux",
      homeDir: root,
      installer: {
        async run(command, args) {
          calls.push({ command, args });
        },
      },
      setupRunner: {
        async run(command, args) {
          setupCalls.push({ command, args });
        },
      },
    });

    await useCases.installPlugin({
      root,
      configPath,
      id: "imp-voice",
    });

    const inServiceName = "imp-voice-in";
    const inDefinitionPath = join(root, ".config", "systemd", "user", `${inServiceName}.service`);
    const inEnvironmentPath = join(root, "plugin-services", `${inServiceName}.env`);
    await expect(readFile(inDefinitionPath, "utf8")).resolves.toContain(
      `WorkingDirectory=${join(root, "imp-voice")}`,
    );
    await expect(readFile(inDefinitionPath, "utf8")).resolves.toContain(
      `ExecStart="bash" "bin/wake-phrase" "--config" "config/wake-phrase.toml"`,
    );
    await expect(readFile(inEnvironmentPath, "utf8")).resolves.toContain('OPENAI_API_KEY="sk-test"');
    await expect(readFile(inEnvironmentPath, "utf8")).resolves.toContain(
      `IMP_VOICE_PYTHON="${join(dataRoot, "plugins", "state", "imp-voice", "python", ".venv", "bin", "python")}"`,
    );
    await expect(readFile(inEnvironmentPath, "utf8")).resolves.toContain(
      `IMP_VOICE_RUNTIME_DIR="${join(dataRoot, "runtime", "plugins", "imp-voice", "endpoints", "audio-ingress")}"`,
    );
    await expect(readFile(inEnvironmentPath, "utf8")).resolves.toContain(
      `IMP_VOICE_RECORDINGS_DIR="${join(dataRoot, "runtime", "plugins", "imp-voice", "recordings")}"`,
    );

    const outServiceName = "imp-voice-out";
    const outDefinitionPath = join(root, ".config", "systemd", "user", `${outServiceName}.service`);
    const outEnvironmentPath = join(root, "plugin-services", `${outServiceName}.env`);
    await expect(readFile(outDefinitionPath, "utf8")).resolves.toContain(
      `WorkingDirectory=${join(root, "imp-voice")}`,
    );
    await expect(readFile(outDefinitionPath, "utf8")).resolves.toContain(
      `ExecStart="${process.execPath}" "bin/speaker-outbox.mjs" "--config" "config/default.json"`,
    );
    await expect(readFile(outEnvironmentPath, "utf8")).resolves.toContain('OPENAI_API_KEY="sk-test"');
    await expect(readFile(outEnvironmentPath, "utf8")).resolves.toContain(
      `IMP_VOICE_RUNTIME_DIR="${join(dataRoot, "runtime", "plugins", "imp-voice", "endpoints", "audio-ingress")}"`,
    );
    expect(setupCalls).toEqual([
      {
        command: "python3",
        args: ["-m", "venv", join(dataRoot, "plugins", "state", "imp-voice", "python", ".venv")],
      },
      {
        command: join(dataRoot, "plugins", "state", "imp-voice", "python", ".venv", "bin", "python"),
        args: ["-m", "pip", "install", "-r", join(root, "imp-voice", "requirements.txt")],
      },
    ]);
    expect(calls).toEqual([
      { command: "systemctl", args: ["--user", "daemon-reload"] },
      { command: "systemctl", args: ["--user", "enable", "--now", `${inServiceName}.service`] },
      { command: "systemctl", args: ["--user", "restart", `${inServiceName}.service`] },
      { command: "systemctl", args: ["--user", "daemon-reload"] },
      { command: "systemctl", args: ["--user", "enable", "--now", `${outServiceName}.service`] },
      { command: "systemctl", args: ["--user", "restart", `${outServiceName}.service`] },
    ]);
    expect(writeOutput).toHaveBeenCalledWith(
      `Installed plugin service "imp-voice:in" at ${inDefinitionPath}`,
    );
    expect(writeOutput).toHaveBeenCalledWith(
      `Installed plugin service "imp-voice:out" at ${outDefinitionPath}`,
    );
  });

  it("uses Windows virtualenv Python path for plugin setup", async () => {
    const root = await createPluginRoot();
    const configPath = join(root, "config.json");
    const dataRoot = join(root, "state");
    const setupCalls: Array<{ command: string; args: string[] }> = [];
    await writeManifest(root, "imp-voice", {
      schemaVersion: 1,
      id: "imp-voice",
      name: "imp Voice",
      version: "0.1.0",
      services: [
        {
          id: "in",
          autoStart: true,
          command: "node",
          args: ["bin/wake-phrase.mjs"],
          env: {
            IMP_VOICE_PYTHON: "{{setup.python.venvPython}}",
          },
        },
      ],
      setup: {
        python: {
          requirements: "requirements.txt",
        },
      },
    });
    await writeFile(configPath, `${JSON.stringify({ ...createConfig(), paths: { dataRoot } }, null, 2)}\n`, "utf8");
    const useCases = createPluginUseCases({
      platform: "linux",
      setupPlatform: "win32",
      homeDir: root,
      installer: {
        async run() {
          // no-op
        },
      },
      setupRunner: {
        async run(command, args) {
          setupCalls.push({ command, args });
        },
      },
    });

    await useCases.installPlugin({
      root,
      configPath,
      id: "imp-voice",
    });

    expect(setupCalls).toEqual([
      {
        command: "python3",
        args: ["-m", "venv", join(dataRoot, "plugins", "state", "imp-voice", "python", ".venv")],
      },
      {
        command: join(dataRoot, "plugins", "state", "imp-voice", "python", ".venv", "Scripts", "python.exe"),
        args: ["-m", "pip", "install", "-r", join(root, "imp-voice", "requirements.txt")],
      },
    ]);
  });

  it("rejects plugin service installation before starting services when required env is missing", async () => {
    const root = await createPluginRoot();
    const configPath = join(root, "config.json");
    const calls: Array<{ command: string; args: string[] }> = [];
    const setupCalls: Array<{ command: string; args: string[] }> = [];
    await writeManifest(root, "imp-voice", {
      schemaVersion: 1,
      id: "imp-voice",
      name: "imp Voice",
      version: "0.1.0",
      services: [
        {
          id: "in",
          command: "bash",
          args: ["bin/wake-phrase"],
        },
        {
          id: "out",
          command: "node",
          args: ["bin/speaker-outbox.mjs"],
          env: {
            OPENAI_API_KEY: "required",
          },
        },
      ],
      setup: {
        python: {
          requirements: "requirements.txt",
        },
      },
    });
    await writeFile(configPath, `${JSON.stringify(createConfig(), null, 2)}\n`, "utf8");
    const useCases = createPluginUseCases({
      writeOutput: vi.fn(),
      env: {},
      platform: "linux",
      homeDir: root,
      installer: {
        async run(command, args) {
          calls.push({ command, args });
        },
      },
      setupRunner: {
        async run(command, args) {
          setupCalls.push({ command, args });
        },
      },
    });

    await expect(
      useCases.installPlugin({
        root,
        configPath,
        id: "imp-voice",
      }),
    ).rejects.toThrow(
      [
        'Plugin "imp-voice" service installation requires missing environment variables:',
        "- out: OPENAI_API_KEY",
        "Export the variables before installing plugin services.",
      ].join("\n"),
    );

    expect(calls).toEqual([]);
    expect(setupCalls).toEqual([]);
    await expect(
      readFile(join(root, ".config", "systemd", "user", "imp-voice-in.service"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(root, ".config", "systemd", "user", "imp-voice-out.service"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("skips plugin service installation when requested", async () => {
    const root = await createPluginRoot();
    const configPath = join(root, "config.json");
    const calls: Array<{ command: string; args: string[] }> = [];
    await writeManifest(root, "imp-voice", {
      schemaVersion: 1,
      id: "imp-voice",
      name: "imp Voice",
      version: "0.1.0",
      services: [
        {
          id: "out",
          command: "node",
          args: ["bin/speaker-outbox.mjs"],
        },
      ],
    });
    await writeFile(configPath, `${JSON.stringify(createConfig(), null, 2)}\n`, "utf8");
    const useCases = createPluginUseCases({
      writeOutput: vi.fn(),
      platform: "linux",
      homeDir: root,
      installer: {
        async run(command, args) {
          calls.push({ command, args });
        },
      },
    });

    await useCases.installPlugin({
      root,
      configPath,
      id: "imp-voice",
      autoStartServices: false,
    });

    expect(calls).toEqual([]);
  });

  it("reinstalls services for already configured plugins", async () => {
    const root = await createPluginRoot();
    const configPath = join(root, "config.json");
    const calls: Array<{ command: string; args: string[] }> = [];
    await writeManifest(root, "imp-voice", {
      schemaVersion: 1,
      id: "imp-voice",
      name: "imp Voice",
      version: "0.1.0",
      services: [
        {
          id: "out",
          command: "node",
          args: ["bin/speaker-outbox.mjs"],
        },
      ],
    });
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          ...createConfig(),
          plugins: [
            {
              id: "imp-voice",
              enabled: true,
              package: {
                path: join(root, "imp-voice"),
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const writeOutput = vi.fn();
    const useCases = createPluginUseCases({
      writeOutput,
      platform: "linux",
      homeDir: root,
      installer: {
        async run(command, args) {
          calls.push({ command, args });
        },
      },
    });

    await useCases.installPlugin({
      configPath,
      id: "imp-voice",
      servicesOnly: true,
      force: true,
    });

    const serviceName = "imp-voice-out";
    expect(calls).toEqual([
      { command: "systemctl", args: ["--user", "daemon-reload"] },
      { command: "systemctl", args: ["--user", "enable", "--now", `${serviceName}.service`] },
      { command: "systemctl", args: ["--user", "restart", `${serviceName}.service`] },
    ]);
    expect(writeOutput).toHaveBeenCalledWith(
      `Installed plugin service "imp-voice:out" at ${join(root, ".config", "systemd", "user", `${serviceName}.service`)}`,
    );
  });

  it("requires configured plugin for services-only installs even when root is provided", async () => {
    const root = await createPluginRoot();
    const configPath = join(root, "config.json");
    await writeManifest(root, "imp-voice", {
      schemaVersion: 1,
      id: "imp-voice",
      name: "imp Voice",
      version: "0.1.0",
      services: [
        {
          id: "out",
          command: "node",
          args: ["bin/speaker-outbox.mjs"],
        },
      ],
    });
    await writeFile(configPath, `${JSON.stringify(createConfig(), null, 2)}\n`, "utf8");
    const useCases = createPluginUseCases();

    await expect(
      useCases.installPlugin({
        root,
        configPath,
        id: "imp-voice",
        servicesOnly: true,
      }),
    ).rejects.toThrow('Plugin "imp-voice" is not configured.');
  });

  it("rejects duplicate plugin ids during install", async () => {
    const root = await createPluginRoot();
    const configPath = join(root, "config.json");
    await writeManifest(root, "imp-voice", {
      schemaVersion: 1,
      id: "imp-voice",
      name: "imp Voice",
      version: "0.1.0",
    });
    await writeFile(
      configPath,
      `${JSON.stringify({ ...createConfig(), plugins: [{ id: "imp-voice", enabled: true }] }, null, 2)}\n`,
      "utf8",
    );
    const useCases = createPluginUseCases();

    await expect(useCases.installPlugin({ root, configPath, id: "imp-voice" })).rejects.toThrow([
      'Plugin "imp-voice" is already configured.',
      "Re-run with --services-only to reinstall plugin services.",
    ].join("\n"));
  });

  it("rejects duplicate endpoint ids during install", async () => {
    const root = await createPluginRoot();
    const configPath = join(root, "config.json");
    await writeManifest(root, "imp-voice", {
      schemaVersion: 1,
      id: "imp-voice",
      name: "imp Voice",
      version: "0.1.0",
      endpoints: [
        {
          id: "audio-ingress",
          response: {
            type: "none",
          },
        },
      ],
    });
    await writeFile(
      configPath,
      `${JSON.stringify({ ...createConfig(), endpoints: [{ id: "audio-ingress", type: "cli", enabled: true }] }, null, 2)}\n`,
      "utf8",
    );
    const useCases = createPluginUseCases();

    await expect(useCases.installPlugin({ root, configPath, id: "imp-voice" })).rejects.toThrow(
      'Endpoint "audio-ingress" already exists in the config.',
    );
  });
});

let tempRoots: string[] = [];

async function createPluginRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "imp-plugin-use-case-test-"));
  tempRoots.push(root);
  return root;
}

async function writeManifest(root: string, id: string, manifest: unknown): Promise<void> {
  const pluginRoot = join(root, id);
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(join(pluginRoot, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function readConfig(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function createConfig(): AppConfig {
  return {
    instance: {
      name: "default",
    },
    paths: {
      dataRoot: "/tmp/imp",
    },
    defaults: {
      agentId: "default",
    },
    agents: [
      {
        id: "default",
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
      },
    ],
    endpoints: [],
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.map((path) => rm(path, { recursive: true, force: true })));
  tempRoots = [];
});

import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTarArchive, extractTarArchive } from "../files/tar-archive.js";
import { createFsConversationStore } from "../storage/fs-store.js";
import { createBackupUseCases } from "./backup-use-cases.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("backup use cases", () => {
  it("creates a scoped archive with agent files and sessions only", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config", "config.json");
    const dataRoot = join(root, "state");
    const promptPath = join(root, "config", "prompts", "SYSTEM.md");
    const authPath = join(root, "config", "oauth.json");
    const agentHomeSkillPath = join(dataRoot, "agents", "default", ".skills", "home-skill", "SKILL.md");
    const conversationPath = join(dataRoot, "sessions", "default", "entries", "session-1", "meta.json");
    const logPath = join(dataRoot, "logs", "endpoints.log");
    const backupPath = join(root, "backup.tar");
    const extractDir = join(root, "extract");

    await writeConfig(configPath, dataRoot);
    await writeTextFile(promptPath, "prompt\n");
    await writeTextFile(authPath, "{\"token\":\"secret\"}\n");
    await writeTextFile(agentHomeSkillPath, "# Home skill\n");
    await writeTextFile(conversationPath, "{\"messages\":[{\"id\":\"1\"}]}\n");
    await writeTextFile(logPath, "ignore me\n");

    const useCases = createBackupUseCases({
      writeOutput: vi.fn(),
    });

    await useCases.createBackup({
      configPath,
      outputPath: backupPath,
      only: "agents,sessions",
      force: false,
    });

    await extractTarArchive(backupPath, extractDir);

    const manifest = JSON.parse(await readFile(join(extractDir, "manifest.json"), "utf8")) as {
      scopes: string[];
      config?: unknown;
      agentFiles?: Array<{ archivePath: string }>;
      agentHomes?: Array<{ archivePath: string }>;
      sessions?: Array<{ archivePath: string }>;
    };

    expect(manifest.scopes).toEqual(["agents", "sessions"]);
    expect(manifest.config).toBeUndefined();
    expect(manifest.agentFiles).toHaveLength(2);
    expect(manifest.agentHomes).toHaveLength(1);
    expect(manifest.sessions).toHaveLength(1);
    await expect(readFile(join(extractDir, manifest.agentFiles?.[0]?.archivePath ?? ""), "utf8")).resolves.toBeDefined();
    await expect(
      readFile(join(extractDir, manifest.agentHomes?.[0]?.archivePath ?? "", ".skills", "home-skill", "SKILL.md"), "utf8"),
    ).resolves.toBe("# Home skill\n");
    await expect(
      readFile(join(extractDir, manifest.sessions?.[0]?.archivePath ?? "", "default", "entries", "session-1", "meta.json"), "utf8"),
    ).resolves.toContain('"id":"1"');
    await expect(readFile(join(extractDir, "logs", "endpoints.log"), "utf8")).rejects.toThrow();
  });

  it("creates backups from paths.dataRoot resolved against the config directory", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config", "config.json");
    const dataRoot = join(root, "config", "state");
    const conversationPath = join(dataRoot, "sessions", "default", "entries", "session-1", "meta.json");
    const backupPath = join(root, "backup.tar");
    const extractDir = join(root, "extract");

    await writeConfig(configPath, "./state");
    await writeTextFile(join(root, "config", "prompts", "SYSTEM.md"), "prompt\n");
    await writeTextFile(join(root, "config", "oauth.json"), "{\"token\":\"secret\"}\n");
    await writeTextFile(conversationPath, "{\"messages\":[{\"id\":\"relative-root\"}]}\n");

    const useCases = createBackupUseCases({
      writeOutput: vi.fn(),
    });

    await useCases.createBackup({
      configPath,
      outputPath: backupPath,
      only: "sessions",
      force: false,
    });

    await extractTarArchive(backupPath, extractDir);
    const manifest = JSON.parse(await readFile(join(extractDir, "manifest.json"), "utf8")) as {
      source: { dataRoot: string };
      sessions?: Array<{ archivePath: string }>;
    };

    expect(manifest.source.dataRoot).toBe(dataRoot);
    expect(manifest.sessions).toHaveLength(1);
    await expect(
      readFile(join(extractDir, manifest.sessions?.[0]?.archivePath ?? "", "default", "entries", "session-1", "meta.json"), "utf8"),
    ).resolves.toContain("relative-root");
  });

  it("inspects a backup archive manifest", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config", "config.json");
    const dataRoot = join(root, "state");
    const promptPath = join(root, "config", "prompts", "SYSTEM.md");
    const authPath = join(root, "config", "oauth.json");
    const agentHomePath = join(dataRoot, "agents", "default");
    const agentHomeSkillPath = join(agentHomePath, ".skills", "home-skill", "SKILL.md");
    const conversationPath = join(dataRoot, "sessions", "default", "entries", "session-1", "meta.json");
    const backupPath = join(root, "backup.tar");
    const writeOutput = vi.fn();

    await writeConfig(configPath, dataRoot);
    await writeTextFile(promptPath, "prompt\n");
    await writeTextFile(authPath, "{\"token\":\"secret\"}\n");
    await writeTextFile(agentHomeSkillPath, "# Home skill\n");
    await writeTextFile(conversationPath, "{\"messages\":[{\"id\":\"inspect\"}]}\n");

    const useCases = createBackupUseCases({
      writeOutput,
    });

    await useCases.createBackup({
      configPath,
      outputPath: backupPath,
      force: false,
    });

    writeOutput.mockClear();

    await useCases.inspectBackup({
      inputPath: backupPath,
    });

    const output = writeOutput.mock.calls[0]?.[0] ?? "";
    expect(writeOutput).toHaveBeenCalledTimes(1);
    expect(output).toContain(`Backup: ${backupPath}`);
    expect(output).toContain("Scopes: config, agents, sessions, bindings");
    expect(output).toContain(`Source config: ${configPath}`);
    expect(output).toContain(`Source data root: ${dataRoot}`);
    expect(output).toContain("Config: config/config.json");
    expect(output).toContain("Agent files: 2");
    expect(output).toContain(`- default model.authFile: ${authPath} -> agents/`);
    expect(output).toContain(`- default prompt.base.file: ${promptPath} -> agents/`);
    expect(output).toContain("Agent homes: 1");
    expect(output).toContain(`- default: ${agentHomePath} -> agent-homes/`);
    expect(output).toContain("Sessions: 1");
    expect(output).toContain("- global: sessions -> sessions");
    expect(output).toContain("Bindings: 0");
  });

  it("restores only the targeted sessions subtree and preserves unrelated data-root content", async () => {
    const sourceRoot = await createTempDir();
    const sourceConfigPath = join(sourceRoot, "config", "config.json");
    const sourceDataRoot = join(sourceRoot, "state");
    const backupPath = join(sourceRoot, "backup.tar");

    await writeConfig(sourceConfigPath, sourceDataRoot);
    await writeTextFile(
      join(sourceDataRoot, "sessions", "default", "entries", "session-1", "meta.json"),
      "{\"messages\":[{\"id\":\"source\"}]}\n",
    );

    const useCases = createBackupUseCases({
      writeOutput: vi.fn(),
    });

    await useCases.createBackup({
      configPath: sourceConfigPath,
      outputPath: backupPath,
      only: "sessions",
      force: false,
    });

    const targetRoot = await createTempDir();
    const targetDataRoot = join(targetRoot, "state");
    await writeTextFile(
      join(targetDataRoot, "sessions", "default", "entries", "session-1", "meta.json"),
      "{\"messages\":[{\"id\":\"old\"}]}\n",
    );
    await writeTextFile(
      join(targetDataRoot, "logs", "endpoints.log"),
      "keep log\n",
    );
    await writeTextFile(
      join(targetDataRoot, "unrelated", "sessions", "telegram", "7", "meta.json"),
      "{\"messages\":[{\"id\":\"other\"}]}\n",
    );

    const restoreUseCases = createBackupUseCases({
      discoverConfigPath: async () => {
        throw new Error("No config found");
      },
      writeOutput: vi.fn(),
    });

    await restoreUseCases.restoreBackup({
      inputPath: backupPath,
      dataRoot: targetDataRoot,
      only: "sessions",
      force: true,
    });

    await expect(
      readFile(
        join(targetDataRoot, "sessions", "default", "entries", "session-1", "meta.json"),
        "utf8",
      ),
    ).resolves.toContain('"source"');
    await expect(readFile(join(targetDataRoot, "logs", "endpoints.log"), "utf8")).resolves.toBe(
      "keep log\n",
    );
    await expect(
      readFile(
        join(targetDataRoot, "unrelated", "sessions", "telegram", "7", "meta.json"),
        "utf8",
      ),
    ).resolves.toContain('"other"');
  });

  it("restores telegram document attachments with relocatable conversation metadata", async () => {
    const sourceRoot = await createTempDir();
    const sourceConfigPath = join(sourceRoot, "config", "config.json");
    const sourceDataRoot = join(sourceRoot, "state");
    const sourceSessionsDir = join(sourceDataRoot, "sessions");
    const sourceStore = createFsConversationStore(createRuntimePaths(sourceDataRoot));
    const created = await sourceStore.create({ transport: "telegram", externalId: "42" }, {
      agentId: "default",
      now: "2026-04-05T00:00:00.000Z",
    });
    const sourceAttachmentPath = join(
      sourceSessionsDir,
      "default",
      "entries",
      created.state.conversation.sessionId!,
      "attachments",
      "msg-1-report.txt",
    );
    const backupPath = join(sourceRoot, "backup.tar");

    await writeConfig(sourceConfigPath, sourceDataRoot);
    await writeTextFile(sourceAttachmentPath, "file contents\n");
    await sourceStore.put({
      state: {
        ...created.state,
        updatedAt: "2026-04-05T00:01:00.000Z",
      },
      messages: [
        {
          kind: "message",
          id: "msg-1",
          role: "user",
          content: "Please inspect this report",
          timestamp: Date.parse("2026-04-05T00:01:00.000Z"),
          createdAt: "2026-04-05T00:01:00.000Z",
          source: {
            kind: "telegram-document",
            document: {
              fileId: "doc-file",
              fileName: "report.txt",
              relativePath: "attachments/msg-1-report.txt",
              savedPath: sourceAttachmentPath,
            },
          },
        },
      ],
    });

    const useCases = createBackupUseCases({
      writeOutput: vi.fn(),
    });
    await useCases.createBackup({
      configPath: sourceConfigPath,
      outputPath: backupPath,
      only: "sessions",
      force: false,
    });

    const targetRoot = await createTempDir();
    const targetDataRoot = join(targetRoot, "state");
    const restoreUseCases = createBackupUseCases({
      discoverConfigPath: async () => {
        throw new Error("No config found");
      },
      writeOutput: vi.fn(),
    });

    await restoreUseCases.restoreBackup({
      inputPath: backupPath,
      dataRoot: targetDataRoot,
      only: "sessions",
      force: true,
    });

    const targetStore = createFsConversationStore(createRuntimePaths(targetDataRoot));
    const restored = await targetStore.get(created.state.conversation);
    const targetAttachmentPath = join(
      targetDataRoot,
      "sessions",
      "default",
      "entries",
      created.state.conversation.sessionId!,
      "attachments",
      "msg-1-report.txt",
    );

    expect(restored?.messages[0]).toMatchObject({
      source: {
        kind: "telegram-document",
        document: {
          relativePath: "attachments/msg-1-report.txt",
          savedPath: targetAttachmentPath,
        },
      },
    });
    await expect(readFile(targetAttachmentPath, "utf8")).resolves.toBe("file contents\n");
    await expect(
      readFile(
        join(
          targetDataRoot,
          "sessions",
          "default",
          "entries",
          created.state.conversation.sessionId!,
          "meta.json",
        ),
        "utf8",
      ),
    ).resolves.not.toContain(sourceAttachmentPath);
  });

  it("fails clearly when a referenced agent file is missing during backup creation", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config", "config.json");
    const dataRoot = join(root, "state");
    const authPath = join(root, "config", "oauth.json");
    const useCases = createBackupUseCases({
      writeOutput: vi.fn(),
    });

    await writeConfig(configPath, dataRoot);
    await writeTextFile(authPath, "{\"token\":\"secret\"}\n");

    await expect(
      useCases.createBackup({
        configPath,
        outputPath: join(root, "backup.tar"),
        only: "agents",
        force: false,
      }),
    ).rejects.toThrow(
      `Referenced agent file not found for agent "default" at prompt.base.file: ${join(root, "config", "prompts", "SYSTEM.md")}`,
    );
  });

  it("rejects agents-only restore into a new location without a target config", async () => {
    const sourceRoot = await createTempDir();
    const sourceConfigPath = join(sourceRoot, "config", "config.json");
    const sourceDataRoot = join(sourceRoot, "state");
    const backupPath = join(sourceRoot, "backup.tar");
    const sourcePromptPath = join(sourceRoot, "config", "prompts", "SYSTEM.md");
    const sourceAuthPath = join(sourceRoot, "config", "oauth.json");
    const targetRoot = await createTempDir();
    const targetConfigPath = join(targetRoot, "config", "config.json");
    const useCases = createBackupUseCases({
      writeOutput: vi.fn(),
    });

    await writeConfig(sourceConfigPath, sourceDataRoot);
    await writeTextFile(sourcePromptPath, "prompt\n");
    await writeTextFile(sourceAuthPath, "{\"token\":\"secret\"}\n");
    await useCases.createBackup({
      configPath: sourceConfigPath,
      outputPath: backupPath,
      only: "agents",
      force: false,
    });

    await expect(
      useCases.restoreBackup({
        inputPath: backupPath,
        configPath: targetConfigPath,
        only: "agents",
        force: false,
      }),
    ).rejects.toThrow(
      "Agent restore requires either restoring config in the same command or pointing --config at an existing target config file.",
    );
  });

  it("relocates absolute data-root agent files during agents-only restore", async () => {
    const sourceRoot = await createTempDir();
    const sourceConfigPath = join(sourceRoot, "config", "config.json");
    const sourceDataRoot = join(sourceRoot, "state");
    const sourcePromptPath = join(sourceDataRoot, "agents", "SYSTEM.md");
    const backupPath = join(sourceRoot, "backup.tar");
    const targetRoot = await createTempDir();
    const targetConfigPath = join(targetRoot, "config", "config.json");
    const targetDataRoot = join(targetRoot, "state");
    const useCases = createBackupUseCases({
      writeOutput: vi.fn(),
    });

    await writeTextFile(
      sourceConfigPath,
      `${JSON.stringify(
        {
          instance: { name: "default" },
          paths: { dataRoot: sourceDataRoot },
          logging: { level: "info" },
          defaults: { agentId: "default" },
          agents: [
            {
              id: "default",
              model: { provider: "openai-codex", modelId: "gpt-5.5" },
              prompt: {
                base: { file: sourcePromptPath },
              },
            },
          ],
          endpoints: [],
        },
        null,
        2,
      )}\n`,
    );
    await writeTextFile(sourcePromptPath, "base prompt\n");
    await writeConfig(targetConfigPath, targetDataRoot);

    await useCases.createBackup({
      configPath: sourceConfigPath,
      outputPath: backupPath,
      only: "agents",
      force: false,
    });

    await useCases.restoreBackup({
      inputPath: backupPath,
      configPath: targetConfigPath,
      only: "agents",
      force: true,
    });

    await expect(readFile(join(targetDataRoot, "agents", "SYSTEM.md"), "utf8")).resolves.toBe("base prompt\n");
  });

  it("restores agent homes during agents-only restore without duplicating files inside the home", async () => {
    const sourceRoot = await createTempDir();
    const sourceConfigPath = join(sourceRoot, "config", "config.json");
    const sourceDataRoot = join(sourceRoot, "state");
    const sourceAgentHome = join(sourceDataRoot, "agents", "default");
    const sourcePromptPath = join(sourceAgentHome, "SYSTEM.md");
    const backupPath = join(sourceRoot, "backup.tar");
    const targetRoot = await createTempDir();
    const targetConfigPath = join(targetRoot, "config", "config.json");
    const targetDataRoot = join(targetRoot, "state");
    const targetAgentHome = join(targetDataRoot, "agents", "default");
    const useCases = createBackupUseCases({
      writeOutput: vi.fn(),
    });

    await writeTextFile(
      sourceConfigPath,
      `${JSON.stringify(
        {
          instance: { name: "default" },
          paths: { dataRoot: sourceDataRoot },
          logging: { level: "info" },
          defaults: { agentId: "default" },
          agents: [
            {
              id: "default",
              model: { provider: "openai-codex", modelId: "gpt-5.5" },
              prompt: {
                base: { file: sourcePromptPath },
              },
            },
          ],
          endpoints: [],
        },
        null,
        2,
      )}\n`,
    );
    await writeTextFile(sourcePromptPath, "home prompt\n");
    await writeTextFile(join(sourceAgentHome, ".skills", "home-skill", "SKILL.md"), "# Home skill\n");
    await writeConfig(targetConfigPath, targetDataRoot);

    await useCases.createBackup({
      configPath: sourceConfigPath,
      outputPath: backupPath,
      only: "agents",
      force: false,
    });

    await useCases.restoreBackup({
      inputPath: backupPath,
      configPath: targetConfigPath,
      only: "agents",
      force: false,
    });

    await expect(readFile(join(targetAgentHome, "SYSTEM.md"), "utf8")).resolves.toBe("home prompt\n");
    await expect(readFile(join(targetAgentHome, ".skills", "home-skill", "SKILL.md"), "utf8")).resolves.toBe(
      "# Home skill\n",
    );
  });

  it("restores absolute agent file paths into the target layout and rewrites config references", async () => {
    const sourceRoot = await createTempDir();
    const sourceConfigPath = join(sourceRoot, "config", "config.json");
    const sourceDataRoot = join(sourceRoot, "state");
    const sourceAgentHome = join(sourceDataRoot, "agents", "default");
    const sourceBasePromptPath = join(sourceDataRoot, "agents", "SYSTEM.md");
    const sourceInstructionPath = join(sourceDataRoot, "agents", "instructions", "STYLE.md");
    const sourceConversationPath = join(
      sourceDataRoot,
      "endpoints",
      "private-telegram",
      "sessions",
      "telegram",
      "42",
      "meta.json",
    );
    const backupPath = join(sourceRoot, "backup.tar");
    const targetRoot = await createTempDir();
    const targetConfigPath = join(targetRoot, "config", "config.json");
    const targetDataRoot = join(targetRoot, "state");
    const useCases = createBackupUseCases({
      writeOutput: vi.fn(),
    });

    await writeTextFile(
      sourceConfigPath,
      `${JSON.stringify(
        {
          instance: { name: "default" },
          paths: { dataRoot: sourceDataRoot },
          logging: { level: "info" },
          defaults: { agentId: "default" },
          agents: [
            {
              id: "default",
              home: sourceAgentHome,
              model: { provider: "openai-codex", modelId: "gpt-5.5", authFile: "./oauth.json" },
              prompt: {
                base: { file: sourceBasePromptPath },
                instructions: [{ file: sourceInstructionPath }],
              },
            },
          ],
          endpoints: [
            {
              id: "private-telegram",
              type: "telegram",
              enabled: true,
              token: "test-token",
              access: { allowedUserIds: [] },
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    await writeTextFile(sourceBasePromptPath, "base prompt\n");
    await writeTextFile(sourceInstructionPath, "instruction prompt\n");
    await writeTextFile(join(sourceAgentHome, "notes.md"), "agent home note\n");
    await writeTextFile(join(sourceRoot, "config", "oauth.json"), "{\"token\":\"secret\"}\n");
    await writeTextFile(sourceConversationPath, "{\"messages\":[{\"id\":\"1\"}]}\n");

    await useCases.createBackup({
      configPath: sourceConfigPath,
      outputPath: backupPath,
      force: false,
    });

    await useCases.restoreBackup({
      inputPath: backupPath,
      configPath: targetConfigPath,
      dataRoot: targetDataRoot,
      force: true,
    });

    const restoredConfig = JSON.parse(await readFile(targetConfigPath, "utf8")) as {
      paths: { dataRoot: string };
      agents: Array<{
        home?: string;
        model?: {
          authFile?: string;
        };
        prompt: {
          base: { file?: string };
          instructions?: Array<{ file?: string }>;
        };
      }>;
    };

    expect(restoredConfig.paths.dataRoot).toBe(targetDataRoot);
    expect(restoredConfig.agents[0]?.home).toBe(join(targetDataRoot, "agents", "default"));
    expect(restoredConfig.agents[0]?.model?.authFile).toBe("./oauth.json");
    expect(restoredConfig.agents[0]?.prompt.base.file).toBe(join(targetDataRoot, "agents", "SYSTEM.md"));
    expect(restoredConfig.agents[0]?.prompt.instructions?.[0]?.file).toBe(
      join(targetDataRoot, "agents", "instructions", "STYLE.md"),
    );
    await expect(readFile(join(targetDataRoot, "agents", "SYSTEM.md"), "utf8")).resolves.toBe("base prompt\n");
    await expect(readFile(join(targetDataRoot, "agents", "instructions", "STYLE.md"), "utf8")).resolves.toBe(
      "instruction prompt\n",
    );
    await expect(readFile(join(targetRoot, "config", "oauth.json"), "utf8")).resolves.toBe("{\"token\":\"secret\"}\n");
    await expect(readFile(join(targetDataRoot, "agents", "default", "notes.md"), "utf8")).resolves.toBe(
      "agent home note\n",
    );
  });

  it("fails clearly when manifest.json contains invalid JSON", async () => {
    const root = await createTempDir();
    const archivePath = join(root, "backup.tar");
    const targetConfigPath = join(root, "config", "config.json");
    const useCases = createBackupUseCases({
      writeOutput: vi.fn(),
    });

    await createBackupArchive(archivePath, [
      ["manifest.json", "{not json}\n"],
    ]);

    await expect(
      useCases.restoreBackup({
        inputPath: archivePath,
        configPath: targetConfigPath,
        force: false,
      }),
    ).rejects.toThrow("Invalid backup archive: invalid JSON in manifest.json");
  });

  it("fails clearly when the archived config contains invalid JSON", async () => {
    const root = await createTempDir();
    const archivePath = join(root, "backup.tar");
    const targetConfigPath = join(root, "config", "config.json");
    const useCases = createBackupUseCases({
      writeOutput: vi.fn(),
    });

    await createBackupArchive(archivePath, [
      [
        "manifest.json",
        `${JSON.stringify(
          {
            version: 1,
            createdAt: "2026-04-07T00:00:00.000Z",
            scopes: ["config"],
            source: {
              configPath: "/source/config.json",
              dataRoot: "/source/state",
            },
            config: {
              archivePath: "config/config.json",
            },
          },
          null,
          2,
        )}\n`,
      ],
      ["config/config.json", "{not json}\n"],
    ]);

    await expect(
      useCases.restoreBackup({
        inputPath: archivePath,
        configPath: targetConfigPath,
        only: "config",
        force: false,
      }),
    ).rejects.toThrow("Invalid backup archive: invalid JSON in config/config.json");
  });

  it("fails restore when manifest paths contain directory traversal", async () => {
    const root = await createTempDir();
    const sourceConfigPath = join(root, "config", "config.json");
    const sourceDataRoot = join(root, "state");
    const backupPath = join(root, "backup.tar");
    const targetDataRoot = join(root, "target-state");
    const extractDir = join(root, "extract");
    const useCases = createBackupUseCases({
      writeOutput: vi.fn(),
    });

    await writeConfig(sourceConfigPath, sourceDataRoot);
    await writeTextFile(
      join(sourceDataRoot, "sessions", "default", "entries", "session-1", "meta.json"),
      "{\"messages\":[{\"id\":\"source\"}]}\n",
    );
    await useCases.createBackup({
      configPath: sourceConfigPath,
      outputPath: backupPath,
      only: "sessions",
      force: false,
    });

    await extractTarArchive(backupPath, extractDir);
    const manifestPath = join(extractDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      sessions: Array<{ archivePath: string; endpointId: string; relativeToDataRoot: string }>;
    };
    manifest.sessions[0]!.relativeToDataRoot = "../../escape";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await createTarArchive(extractDir, backupPath);

    await expect(
      useCases.restoreBackup({
        inputPath: backupPath,
        dataRoot: targetDataRoot,
        only: "sessions",
        force: true,
      }),
    ).rejects.toThrow("Invalid backup archive: unsafe manifest path");
  });

  it("fails restore when manifest paths are absolute", async () => {
    const root = await createTempDir();
    const archivePath = join(root, "backup.tar");
    const targetDataRoot = join(root, "target-state");
    const useCases = createBackupUseCases({
      writeOutput: vi.fn(),
    });

    await createBackupArchive(archivePath, [
      [
        "manifest.json",
        `${JSON.stringify(
          {
            version: 1,
            createdAt: "2026-04-07T00:00:00.000Z",
            scopes: ["sessions"],
            source: {
              configPath: "/source/config.json",
              dataRoot: "/source/state",
            },
            sessions: [
              {
                archivePath: "/sessions/private-telegram",
                endpointId: "private-telegram",
                relativeToDataRoot: "endpoints/private-telegram/sessions",
              },
            ],
          },
          null,
          2,
        )}\n`,
      ],
    ]);

    await expect(
      useCases.restoreBackup({
        inputPath: archivePath,
        dataRoot: targetDataRoot,
        only: "sessions",
        force: true,
      }),
    ).rejects.toThrow("Invalid backup archive: unsafe manifest path");
  });

  it("fails restore when manifest file archivePath is dot", async () => {
    const root = await createTempDir();
    const archivePath = join(root, "backup.tar");
    const targetDataRoot = join(root, "target-state");
    const useCases = createBackupUseCases({
      writeOutput: vi.fn(),
    });

    await createBackupArchive(archivePath, [
      [
        "manifest.json",
        `${JSON.stringify(
          {
            version: 1,
            createdAt: "2026-04-07T00:00:00.000Z",
            scopes: ["sessions"],
            source: {
              configPath: "/source/config.json",
              dataRoot: "/source/state",
            },
            sessions: [
              {
                archivePath: ".",
                endpointId: "private-telegram",
                relativeToDataRoot: "endpoints/private-telegram/sessions",
              },
            ],
          },
          null,
          2,
        )}\n`,
      ],
    ]);

    await expect(
      useCases.restoreBackup({
        inputPath: archivePath,
        dataRoot: targetDataRoot,
        only: "sessions",
        force: true,
      }),
    ).rejects.toThrow("Invalid backup archive: unsafe manifest path");
  });

  it("fails restore when manifest archivePath contains dot segments", async () => {
    const root = await createTempDir();
    const archivePath = join(root, "backup.tar");
    const targetDataRoot = join(root, "target-state");
    const useCases = createBackupUseCases({
      writeOutput: vi.fn(),
    });

    await createBackupArchive(archivePath, [
      [
        "manifest.json",
        `${JSON.stringify(
          {
            version: 1,
            createdAt: "2026-04-07T00:00:00.000Z",
            scopes: ["sessions"],
            source: {
              configPath: "/source/config.json",
              dataRoot: "/source/state",
            },
            sessions: [
              {
                archivePath: "a/./b",
                endpointId: "private-telegram",
                relativeToDataRoot: "endpoints/private-telegram/sessions",
              },
            ],
          },
          null,
          2,
        )}\n`,
      ],
    ]);

    await expect(
      useCases.restoreBackup({
        inputPath: archivePath,
        dataRoot: targetDataRoot,
        only: "sessions",
        force: true,
      }),
    ).rejects.toThrow("Invalid backup archive: unsafe manifest path");
  });
});

async function writeConfig(configPath: string, dataRoot: string): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeTextFile(
    configPath,
    `${JSON.stringify(
      {
        instance: { name: "default" },
        paths: { dataRoot },
        logging: { level: "info" },
        defaults: { agentId: "default" },
        agents: [
          {
            id: "default",
            model: { provider: "openai-codex", modelId: "gpt-5.5", authFile: "./oauth.json" },
            prompt: {
              base: {
                file: "./prompts/SYSTEM.md",
              },
            },
          },
        ],
        endpoints: [
          {
            id: "private-telegram",
            type: "telegram",
            enabled: true,
            token: "test-token",
            access: { allowedUserIds: [] },
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

async function writeTextFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-backup-test-"));
  tempDirs.push(path);
  return path;
}

async function createBackupArchive(archivePath: string, files: Array<[archivePath: string, content: string]>): Promise<void> {
  const root = await createTempDir();
  const archiveRoot = join(root, "archive");

  for (const [path, content] of files) {
    await writeTextFile(join(archiveRoot, path), content);
  }

  await createTarArchive(archiveRoot, archivePath);
}

function createRuntimePaths(dataRoot: string) {
  return {
    dataRoot,
    sessionsDir: join(dataRoot, "sessions"),
    bindingsDir: join(dataRoot, "bindings"),
    logsDir: join(dataRoot, "logs"),
    logFilePath: join(dataRoot, "logs", "endpoints.log"),
    runtimeDir: join(dataRoot, "runtime", "endpoints"),
    runtimeStatePath: join(dataRoot, "runtime", "endpoints", "private-telegram.json"),
  };
}

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
  it("creates a scoped archive with agent files and conversations only", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config", "config.json");
    const dataRoot = join(root, "state");
    const promptPath = join(root, "config", "prompts", "SYSTEM.md");
    const authPath = join(root, "config", "oauth.json");
    const conversationPath = join(dataRoot, "conversations", "chats", "telegram", "42", "meta.json");
    const logPath = join(dataRoot, "logs", "endpoints", "private-telegram.log");
    const backupPath = join(root, "backup.tar");
    const extractDir = join(root, "extract");

    await writeConfig(configPath, dataRoot);
    await writeTextFile(promptPath, "prompt\n");
    await writeTextFile(authPath, "{\"token\":\"secret\"}\n");
    await writeTextFile(conversationPath, "{\"messages\":[{\"id\":\"1\"}]}\n");
    await writeTextFile(logPath, "ignore me\n");

    const useCases = createBackupUseCases({
      writeOutput: vi.fn(),
    });

    await useCases.createBackup({
      configPath,
      outputPath: backupPath,
      only: "agents,conversations",
      force: false,
    });

    await extractTarArchive(backupPath, extractDir);

    const manifest = JSON.parse(await readFile(join(extractDir, "manifest.json"), "utf8")) as {
      scopes: string[];
      config?: unknown;
      agentFiles?: Array<{ archivePath: string }>;
      conversations?: Array<{ archivePath: string }>;
    };

    expect(manifest.scopes).toEqual(["agents", "conversations"]);
    expect(manifest.config).toBeUndefined();
    expect(manifest.agentFiles).toHaveLength(2);
    expect(manifest.conversations).toHaveLength(1);
    await expect(readFile(join(extractDir, manifest.agentFiles?.[0]?.archivePath ?? ""), "utf8")).resolves.toBeDefined();
    await expect(
      readFile(join(extractDir, manifest.conversations?.[0]?.archivePath ?? "", "chats", "telegram", "42", "meta.json"), "utf8"),
    ).resolves.toContain('"id":"1"');
    await expect(readFile(join(extractDir, "logs", "endpoints", "private-telegram.log"), "utf8")).rejects.toThrow();
  });

  it("creates backups from paths.dataRoot resolved against the config directory", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config", "config.json");
    const dataRoot = join(root, "config", "state");
    const conversationPath = join(dataRoot, "conversations", "chats", "telegram", "42", "meta.json");
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
      only: "conversations",
      force: false,
    });

    await extractTarArchive(backupPath, extractDir);
    const manifest = JSON.parse(await readFile(join(extractDir, "manifest.json"), "utf8")) as {
      source: { dataRoot: string };
      conversations?: Array<{ archivePath: string }>;
    };

    expect(manifest.source.dataRoot).toBe(dataRoot);
    expect(manifest.conversations).toHaveLength(1);
    await expect(
      readFile(join(extractDir, manifest.conversations?.[0]?.archivePath ?? "", "chats", "telegram", "42", "meta.json"), "utf8"),
    ).resolves.toContain("relative-root");
  });

  it("restores only the targeted conversations subtree and preserves unrelated data-root content", async () => {
    const sourceRoot = await createTempDir();
    const sourceConfigPath = join(sourceRoot, "config", "config.json");
    const sourceDataRoot = join(sourceRoot, "state");
    const backupPath = join(sourceRoot, "backup.tar");

    await writeConfig(sourceConfigPath, sourceDataRoot);
    await writeTextFile(
      join(sourceDataRoot, "conversations", "chats", "telegram", "42", "meta.json"),
      "{\"messages\":[{\"id\":\"source\"}]}\n",
    );

    const useCases = createBackupUseCases({
      writeOutput: vi.fn(),
    });

    await useCases.createBackup({
      configPath: sourceConfigPath,
      outputPath: backupPath,
      only: "conversations",
      force: false,
    });

    const targetRoot = await createTempDir();
    const targetDataRoot = join(targetRoot, "state");
    await writeTextFile(
      join(targetDataRoot, "conversations", "chats", "telegram", "42", "meta.json"),
      "{\"messages\":[{\"id\":\"old\"}]}\n",
    );
    await writeTextFile(
      join(targetDataRoot, "logs", "endpoints", "private-telegram.log"),
      "keep log\n",
    );
    await writeTextFile(
      join(targetDataRoot, "endpoints", "another-endpoint", "conversations", "telegram", "7", "meta.json"),
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
      only: "conversations",
      force: true,
    });

    await expect(
      readFile(
        join(targetDataRoot, "conversations", "chats", "telegram", "42", "meta.json"),
        "utf8",
      ),
    ).resolves.toContain('"source"');
    await expect(readFile(join(targetDataRoot, "logs", "endpoints", "private-telegram.log"), "utf8")).resolves.toBe(
      "keep log\n",
    );
    await expect(
      readFile(
        join(targetDataRoot, "endpoints", "another-endpoint", "conversations", "telegram", "7", "meta.json"),
        "utf8",
      ),
    ).resolves.toContain('"other"');
  });

  it("restores telegram document attachments with relocatable conversation metadata", async () => {
    const sourceRoot = await createTempDir();
    const sourceConfigPath = join(sourceRoot, "config", "config.json");
    const sourceDataRoot = join(sourceRoot, "state");
    const sourceConversationsDir = join(sourceDataRoot, "conversations");
    const sourceStore = createFsConversationStore(createRuntimePaths(sourceDataRoot));
    const created = await sourceStore.create({ transport: "telegram", externalId: "42" }, {
      agentId: "default",
      now: "2026-04-05T00:00:00.000Z",
    });
    const sourceAttachmentPath = join(
      sourceConversationsDir,
      "agents",
      "default",
      "sessions",
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
      only: "conversations",
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
      only: "conversations",
      force: true,
    });

    const targetStore = createFsConversationStore(createRuntimePaths(targetDataRoot));
    const restored = await targetStore.get(created.state.conversation);
    const targetAttachmentPath = join(
      targetDataRoot,
      "conversations",
      "agents",
      "default",
      "sessions",
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
          "conversations",
          "agents",
          "default",
          "sessions",
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
      "Agent file restore requires either restoring config in the same command or pointing --config at an existing target config file.",
    );
  });

  it("restores absolute agent file paths into the target layout and rewrites config references", async () => {
    const sourceRoot = await createTempDir();
    const sourceConfigPath = join(sourceRoot, "config", "config.json");
    const sourceDataRoot = join(sourceRoot, "state");
    const sourceBasePromptPath = join(sourceDataRoot, "agents", "SYSTEM.md");
    const sourceInstructionPath = join(sourceDataRoot, "agents", "instructions", "STYLE.md");
    const sourceConversationPath = join(
      sourceDataRoot,
      "endpoints",
      "private-telegram",
      "conversations",
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
              model: { provider: "openai-codex", modelId: "gpt-5.4" },
              authFile: "./oauth.json",
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
        authFile?: string;
        prompt: {
          base: { file?: string };
          instructions?: Array<{ file?: string }>;
        };
      }>;
    };

    expect(restoredConfig.paths.dataRoot).toBe(targetDataRoot);
    expect(restoredConfig.agents[0]?.authFile).toBe("./oauth.json");
    expect(restoredConfig.agents[0]?.prompt.base.file).toBe(join(targetDataRoot, "agents", "SYSTEM.md"));
    expect(restoredConfig.agents[0]?.prompt.instructions?.[0]?.file).toBe(
      join(targetDataRoot, "agents", "instructions", "STYLE.md"),
    );
    await expect(readFile(join(targetDataRoot, "agents", "SYSTEM.md"), "utf8")).resolves.toBe("base prompt\n");
    await expect(readFile(join(targetDataRoot, "agents", "instructions", "STYLE.md"), "utf8")).resolves.toBe(
      "instruction prompt\n",
    );
    await expect(readFile(join(targetRoot, "config", "oauth.json"), "utf8")).resolves.toBe("{\"token\":\"secret\"}\n");
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
      join(sourceDataRoot, "conversations", "chats", "telegram", "42", "meta.json"),
      "{\"messages\":[{\"id\":\"source\"}]}\n",
    );
    await useCases.createBackup({
      configPath: sourceConfigPath,
      outputPath: backupPath,
      only: "conversations",
      force: false,
    });

    await extractTarArchive(backupPath, extractDir);
    const manifestPath = join(extractDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      conversations: Array<{ archivePath: string; endpointId: string; relativeToDataRoot: string }>;
    };
    manifest.conversations[0]!.relativeToDataRoot = "../../escape";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await createTarArchive(extractDir, backupPath);

    await expect(
      useCases.restoreBackup({
        inputPath: backupPath,
        dataRoot: targetDataRoot,
        only: "conversations",
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
            scopes: ["conversations"],
            source: {
              configPath: "/source/config.json",
              dataRoot: "/source/state",
            },
            conversations: [
              {
                archivePath: "/conversations/private-telegram",
                endpointId: "private-telegram",
                relativeToDataRoot: "endpoints/private-telegram/conversations",
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
        only: "conversations",
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
            model: { provider: "openai-codex", modelId: "gpt-5.4" },
            authFile: "./oauth.json",
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
    conversationsDir: join(dataRoot, "conversations"),
    logsDir: join(dataRoot, "logs", "endpoints"),
    logFilePath: join(dataRoot, "logs", "endpoints", "private-telegram.log"),
    runtimeDir: join(dataRoot, "runtime", "endpoints"),
    runtimeStatePath: join(dataRoot, "runtime", "endpoints", "private-telegram.json"),
  };
}

import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTarArchive, extractTarArchive } from "../files/tar-archive.js";
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
    const conversationPath = join(dataRoot, "bots", "private-telegram", "conversations", "telegram", "42", "conversation.json");
    const logPath = join(dataRoot, "bots", "private-telegram", "logs", "daemon.log");
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
      readFile(join(extractDir, manifest.conversations?.[0]?.archivePath ?? "", "telegram", "42", "conversation.json"), "utf8"),
    ).resolves.toContain('"id":"1"');
    await expect(readFile(join(extractDir, "conversations", "private-telegram", "logs", "daemon.log"), "utf8")).rejects.toThrow();
  });

  it("restores only the targeted conversations subtree and preserves unrelated data-root content", async () => {
    const sourceRoot = await createTempDir();
    const sourceConfigPath = join(sourceRoot, "config", "config.json");
    const sourceDataRoot = join(sourceRoot, "state");
    const backupPath = join(sourceRoot, "backup.tar");

    await writeConfig(sourceConfigPath, sourceDataRoot);
    await writeTextFile(
      join(sourceDataRoot, "bots", "private-telegram", "conversations", "telegram", "42", "conversation.json"),
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
      join(targetDataRoot, "bots", "private-telegram", "conversations", "telegram", "42", "conversation.json"),
      "{\"messages\":[{\"id\":\"old\"}]}\n",
    );
    await writeTextFile(
      join(targetDataRoot, "bots", "private-telegram", "logs", "daemon.log"),
      "keep log\n",
    );
    await writeTextFile(
      join(targetDataRoot, "bots", "another-bot", "conversations", "telegram", "7", "conversation.json"),
      "{\"messages\":[{\"id\":\"other\"}]}\n",
    );

    await useCases.restoreBackup({
      inputPath: backupPath,
      dataRoot: targetDataRoot,
      only: "conversations",
      force: true,
    });

    await expect(
      readFile(
        join(targetDataRoot, "bots", "private-telegram", "conversations", "telegram", "42", "conversation.json"),
        "utf8",
      ),
    ).resolves.toContain('"source"');
    await expect(readFile(join(targetDataRoot, "bots", "private-telegram", "logs", "daemon.log"), "utf8")).resolves.toBe(
      "keep log\n",
    );
    await expect(
      readFile(
        join(targetDataRoot, "bots", "another-bot", "conversations", "telegram", "7", "conversation.json"),
        "utf8",
      ),
    ).resolves.toContain('"other"');
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
      "bots",
      "private-telegram",
      "conversations",
      "telegram",
      "42",
      "conversation.json",
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
          bots: [
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
        bots: [
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

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { appConfigSchema } from "./schema.js";
import { loadAppConfig } from "./load-app-config.js";
import { resolveRuntimeConfig } from "./resolve-runtime-config.js";
import type { AppConfig } from "./types.js";
import { registerTransport } from "../transports/registry.js";

type RegisterTransportEntry = Parameters<typeof registerTransport>[1];

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      const { rm } = await import("node:fs/promises");
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("resolveRuntimeConfig", () => {
  it("maps enabled telegram endpoints into daemon runtime config", async () => {
    const appConfig = createAppConfig({
      defaults: {
        agentId: "default-agent",
      },
      agents: [
        {
          id: "default-agent",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          inference: {
            metadata: {
              app: "imp",
            },
            request: {
              store: true,
            },
          },
          tools: ["read"],
          prompt: {
            base: {
              text: "You are the configured default agent.",
            },
          },
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: ["42"],
          },
          voice: {
            enabled: true,
            transcription: {
              provider: "openai",
              model: "gpt-4o-mini-transcribe",
              language: "en",
            },
          },
          document: {
            maxDownloadBytes: 1048576,
          },
          routing: {
            defaultAgentId: "ops-agent",
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.configPath).toBe("/etc/imp/config.json");
    expect(result.logging).toEqual({
      level: "info",
    });
    expect(result.agents).toEqual([
      {
        id: "default-agent",
        home: "/var/lib/imp/agents/default-agent",
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
        inference: {
          metadata: {
            app: "imp",
          },
          request: {
            store: true,
          },
        },
        tools: ["read"],
        prompt: {
          base: {
            text: "You are the configured default agent.",
          },
        },
      },
    ]);
    expect(result.activeEndpoints).toEqual([
      {
        id: "private-telegram",
        type: "telegram",
        token: "telegram-token",
        allowedUserIds: ["42"],
        voice: {
          enabled: true,
          transcription: {
            provider: "openai",
            model: "gpt-4o-mini-transcribe",
            language: "en",
          },
        },
        document: {
          maxDownloadBytes: 1048576,
        },
        defaultAgentId: "ops-agent",
        paths: {
          dataRoot: "/var/lib/imp",
          conversationsDir: "/var/lib/imp/conversations",
          logsDir: "/var/lib/imp/logs/endpoints",
          logFilePath: "/var/lib/imp/logs/endpoints/private-telegram.log",
          runtimeDir: "/var/lib/imp/runtime/endpoints",
          runtimeStatePath: "/var/lib/imp/runtime/endpoints/private-telegram.json",
        },
      },
    ]);
  });

  it("does not start enabled cli endpoints in daemon runtime config", async () => {
    const appConfig = createAppConfig({
      endpoints: [
        {
          id: "local-cli",
          type: "cli",
          enabled: true,
          routing: {
            defaultAgentId: "default",
          },
        },
      ],
    });

    await expect(resolveRuntimeConfig(appConfig, "/etc/imp/config.json")).rejects.toThrowError(
      "Config must enable at least one daemon endpoint.",
    );
  });

  it("discovers valid agent skills from configured paths", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config", "imp.json");
    const skillsPath = join(root, "config", "skills");
    await writeRawFile(
      join(skillsPath, "commit", "SKILL.md"),
      ["---", "name: commit", "description: Stage and commit changes.", "---", "", "Use focused commits."].join("\n"),
    );

    const appConfig = createAppConfig({
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          inference: {
            metadata: {
              app: "imp",
            },
            request: {
              store: true,
            },
          },
          tools: [],
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          skills: {
            paths: ["./skills"],
          },
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, configPath);

    expect(result.agents[0]?.skills).toEqual({
      paths: [skillsPath],
    });
    expect(result.agents[0]?.skillCatalog).toHaveLength(1);
    expect(result.agents[0]?.skillCatalog?.[0]).toMatchObject({
      name: "commit",
      description: "Stage and commit changes.",
      filePath: join(skillsPath, "commit", "SKILL.md"),
    });
    expect(result.agents[0]?.skillIssues ?? []).toEqual([]);
  });

  it("uses the built-in default prompt when no prompt base is configured", async () => {
    const appConfig = createAppConfig({
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          tools: [],
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.agents[0]?.prompt).toEqual({
      base: {
        builtIn: "default",
      },
    });
  });

  it("resolves delegated agent tool config with derived default tool names", async () => {
    const appConfig = createAppConfig({
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          tools: {
            builtIn: ["read"],
            agents: [
              {
                agentId: "helper.agent",
              },
              {
                agentId: "writer",
                toolName: "draft_copy",
                description: "Ask the writer agent for a draft.",
              },
            ],
          },
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
        },
        {
          id: "helper.agent",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          tools: [],
          prompt: {
            base: {
              text: "You help.",
            },
          },
        },
        {
          id: "writer",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          tools: [],
          prompt: {
            base: {
              text: "You write.",
            },
          },
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.agents[0]?.delegations).toEqual([
      {
        agentId: "helper.agent",
        toolName: "ask_helper_agent",
      },
      {
        agentId: "writer",
        toolName: "draft_copy",
        description: "Ask the writer agent for a draft.",
      },
    ]);
  });

  it("preserves custom model settings in runtime config", async () => {
    const appConfig = createAppConfig({
      agents: [
        {
          id: "local-lms",
          model: {
            provider: "openai",
            modelId: "qwen/qwen3-coder-next",
            api: "openai-responses",
            baseUrl: "http://pc:1234/v1",
            reasoning: false,
            input: ["text"],
            contextWindow: 262144,
            maxTokens: 32768,
          },
          tools: [],
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.agents[0]?.model).toEqual({
      provider: "openai",
      modelId: "qwen/qwen3-coder-next",
      api: "openai-responses",
      baseUrl: "http://pc:1234/v1",
      reasoning: false,
      input: ["text"],
      contextWindow: 262144,
      maxTokens: 32768,
    });
  });

  it("uses the global default agent id when the endpoint has no routing override", async () => {
    const appConfig = createAppConfig({
      defaults: {
        agentId: "default-agent",
      },
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.activeEndpoints[0]?.defaultAgentId).toBe("default-agent");
  });

  it("resolves relative prompt and workspace paths against the config directory", async () => {
    const appConfig = createAppConfig({
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          prompt: {
            base: {
              file: "./prompts/default.md",
            },
            instructions: [{ file: "./AGENTS.md" }],
            references: [{ file: "/opt/shared/README.md" }],
          },
          workspace: {
            cwd: "./workspace",
          },
          tools: ["read", "bash"],
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.agents[0]?.prompt).toEqual({
      base: { file: "/etc/imp/prompts/default.md" },
      instructions: [{ file: "/etc/imp/AGENTS.md" }],
      references: [{ file: "/opt/shared/README.md" }],
    });
    expect(result.agents[0]?.home).toBe("/var/lib/imp/agents/default");
    expect(result.agents[0]?.workspace).toEqual({
      cwd: "/etc/imp/workspace",
    });
    expect(result.agents[0]?.tools).toEqual(["read", "bash"]);
  });


  it("automatically loads user plugins from dataRoot/plugins at runtime", async () => {
    const root = await createTempDir();
    const dataRoot = join(root, "state");
    const pluginRoot = join(dataRoot, "plugins", "notes");
    await writeRawFile(join(pluginRoot, "imp-plugin.json"), JSON.stringify({
      schemaVersion: 1,
      id: "notes",
      name: "Notes",
      version: "0.1.0",
      skills: [{ path: "./skills" }],
      tools: [
        {
          name: "search",
          description: "Search notes.",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false,
          },
          runner: {
            type: "command",
            command: "node",
            args: ["./search.mjs"],
          },
        },
      ],
      mcpServers: [
        {
          id: "vault",
          command: "node",
          args: ["./server.mjs"],
          cwd: "./mcp",
        },
      ],
      agents: [
        {
          id: "assistant",
          model: { provider: "openai", modelId: "gpt-5.4" },
          prompt: { base: { file: "./prompts/assistant.md" } },
          tools: {
            builtIn: ["search", "read"],
            mcp: { servers: ["vault"] },
          },
          skills: { paths: ["./agent-skills"] },
        },
      ],
    }, null, 2));

    const result = await resolveRuntimeConfig(
      createAppConfig({
        paths: { dataRoot },
        agents: [
          {
            id: "default",
            model: { provider: "openai", modelId: "gpt-5.4" },
            prompt: { base: { text: "Default" } },
            tools: ["notes.search"],
            skills: { paths: [] },
          },
        ],
        endpoints: [
          {
            id: "private-telegram",
            type: "telegram",
            enabled: true,
            token: "telegram-token",
            access: { allowedUserIds: [] },
          },
        ],
      }),
      join(root, "config.json"),
    );

    expect(result.commandTools).toHaveLength(1);
    expect(result.commandTools?.[0]).toMatchObject({
      pluginId: "notes",
      pluginRoot,
      manifest: { name: "search" },
    });
    expect(result.agents.map((agent) => agent.id)).toEqual(["default", "notes.assistant"]);
    expect(result.agents[0]?.tools).toEqual(["notes.search"]);
    expect(result.agents[0]?.skills?.paths).toEqual([]);
    expect(result.agents[0]?.skillCatalog).toBeUndefined();
    expect(result.agents[1]).toMatchObject({
      id: "notes.assistant",
      prompt: { base: { file: join(pluginRoot, "prompts", "assistant.md") } },
      tools: ["notes.search", "read"],
      mcp: {
        servers: [
          {
            id: "notes.vault",
            command: "node",
            args: ["./server.mjs"],
            cwd: join(pluginRoot, "mcp"),
          },
        ],
      },
      skills: { paths: [join(pluginRoot, "agent-skills")] },
    });
  });




  it("loads agent home plugins after dataRoot plugins", async () => {
    const root = await createTempDir();
    const dataRoot = join(root, "state");
    const agentHome = join(root, "agents", "default");
    const dataPluginRoot = join(dataRoot, "plugins", "echo");
    const homePluginRoot = join(agentHome, "plugins", "echo");
    await writeRawFile(join(dataPluginRoot, "imp-plugin.json"), JSON.stringify({
      schemaVersion: 1,
      id: "echo",
      name: "Echo",
      version: "0.1.0",
      tools: [
        {
          name: "say",
          description: "Data root echo.",
          runner: { type: "command", command: "node", args: ["./data-root.mjs"] },
        },
      ],
    }, null, 2));
    await writeRawFile(join(homePluginRoot, "imp-plugin.json"), JSON.stringify({
      schemaVersion: 1,
      id: "echo",
      name: "Echo",
      version: "0.2.0",
      tools: [
        {
          name: "say",
          description: "Agent home echo.",
          runner: { type: "command", command: "node", args: ["./agent-home.mjs"] },
        },
      ],
    }, null, 2));

    const result = await resolveRuntimeConfig(
      createAppConfig({
        paths: { dataRoot },
        agents: [
          {
            id: "default",
            home: agentHome,
            model: { provider: "openai", modelId: "gpt-5.4" },
            prompt: { base: { text: "Default" } },
            tools: ["echo.say"],
          },
        ],
        endpoints: [
          {
            id: "private-telegram",
            type: "telegram",
            enabled: true,
            token: "telegram-token",
            access: { allowedUserIds: [] },
          },
        ],
      }),
      join(root, "config.json"),
    );

    expect(result.commandTools).toHaveLength(1);
    expect(result.commandTools?.[0]).toMatchObject({
      pluginId: "echo",
      pluginRoot: homePluginRoot,
      manifest: { description: "Agent home echo." },
    });
  });

  it("loads JS plugin tools from the runtime module", async () => {
    const root = await createTempDir();
    const dataRoot = join(root, "state");
    const pluginRoot = join(dataRoot, "plugins", "math");
    await writeRawFile(join(pluginRoot, "plugin.mjs"), `export function registerPlugin(context) {
  return {
    tools: [
      {
        name: "add",
        label: "add",
        description: "Add two numbers.",
        parameters: {
          type: "object",
          properties: { a: { type: "number" }, b: { type: "number" } },
          required: ["a", "b"],
          additionalProperties: false,
        },
        async execute(_toolCallId, params) {
          return {
            content: [{ type: "text", text: String(params.a + params.b) }],
            details: { pluginId: context.plugin.id, sum: params.a + params.b },
          };
        },
      },
    ],
  };
}
`);
    await writeRawFile(join(pluginRoot, "imp-plugin.json"), JSON.stringify({
      schemaVersion: 1,
      id: "math",
      name: "Math",
      version: "0.1.0",
      runtime: { module: "./plugin.mjs" },
      agents: [
        {
          id: "assistant",
          model: { provider: "openai", modelId: "gpt-5.4" },
          tools: ["add"],
        },
      ],
    }, null, 2));

    const result = await resolveRuntimeConfig(
      createAppConfig({
        paths: { dataRoot },
        endpoints: [
          {
            id: "private-telegram",
            type: "telegram",
            enabled: true,
            token: "telegram-token",
            access: { allowedUserIds: [] },
          },
        ],
      }),
      join(root, "config.json"),
    );

    expect(result.agents.find((agent) => agent.id === "math.assistant")?.tools).toEqual(["math.add"]);
    expect(result.pluginTools?.map((tool) => tool.name)).toEqual(["math.add"]);
    await expect(result.pluginTools?.[0]?.execute("call-1", { a: 2, b: 3 })).resolves.toEqual({
      content: [{ type: "text", text: "5" }],
      details: { pluginId: "math", sum: 5 },
    });
  });

  it("allows configured agents to reference namespaced MCP servers from automatic plugins", () => {
    const result = appConfigSchema.safeParse(createAppConfig({
      agents: [
        {
          id: "default",
          model: { provider: "openai", modelId: "gpt-5.4" },
          prompt: { base: { text: "Default" } },
          tools: { mcp: { servers: ["notes.vault"] } },
        },
      ],
      endpoints: [],
    }));

    expect(result.success).toBe(true);
  });

  it("uses config-directory-resolved paths.dataRoot from loaded config", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config", "imp.json");
    await writeRawFile(
      configPath,
      `${JSON.stringify(
        createAppConfig({
          paths: {
            dataRoot: "./state",
          },
          endpoints: [
            {
              id: "private-telegram",
              type: "telegram",
              enabled: true,
              token: "telegram-token",
              access: {
                allowedUserIds: [],
              },
            },
          ],
        }),
        null,
        2,
      )}\n`,
    );

    const result = await resolveRuntimeConfig(await loadAppConfig(configPath), configPath);

    const dataRoot = join(root, "config", "state");
    expect(result.agents[0]?.home).toBe(join(dataRoot, "agents", "default"));
    expect(result.activeEndpoints[0]?.paths).toMatchObject({
      dataRoot,
      conversationsDir: join(dataRoot, "conversations"),
      logsDir: join(dataRoot, "logs", "endpoints"),
      runtimeDir: join(dataRoot, "runtime", "endpoints"),
    });
  });

  it("resolves explicit agent home relative to the config directory", async () => {
    const appConfig = createAppConfig({
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          home: "./agents/custom",
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.agents[0]?.home).toBe("/etc/imp/agents/custom");
  });

  it("resolves MCP server cwd relative to the config directory", async () => {
    const appConfig = createAppConfig({
      tools: {
        mcp: {
          inheritEnv: ["OPENAI_API_KEY"],
          servers: [
            {
              id: "echo",
              command: "node",
              args: ["./server.mjs"],
              inheritEnv: ["GITHUB_TOKEN"],
              cwd: "./mcp",
            },
          ],
        },
      },
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          tools: {
            builtIn: ["read"],
            mcp: {
              servers: ["echo"],
            },
          },
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.agents[0]?.tools).toEqual(["read"]);
    expect(result.agents[0]?.mcp).toEqual({
      servers: [
        {
          id: "echo",
          command: "node",
          args: ["./server.mjs"],
          inheritEnv: ["OPENAI_API_KEY", "GITHUB_TOKEN"],
          cwd: "/etc/imp/mcp",
        },
      ],
    });
  });

  it("preserves phone contact config for plugin tools", async () => {
    const appConfig = createAppConfig({
      tools: {
        mcp: {
          servers: [
            {
              id: "imp-phone",
              command: "node",
              args: ["bin/mcp-server.mjs"],
              env: {
                IMP_PHONE_AGENT_ID: "{{agent.id}}",
              },
            },
          ],
        },
      },
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
          tools: {
            mcp: {
              servers: ["imp-phone"],
            },
            phone: {
              contacts: [
                {
                  id: "office",
                  name: "Office",
                  uri: "sip:+491234567@example.com",
                  comment: "work colleague",
                },
              ],
            },
          },
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.agents[0]?.tools).toBeUndefined();
    expect(result.agents[0]?.mcp).toEqual({
      servers: [
        {
          id: "imp-phone",
          command: "node",
          args: ["bin/mcp-server.mjs"],
          env: {
            IMP_PHONE_AGENT_ID: "default",
          },
        },
      ],
    });
    expect(result.agents[0]?.phone).toEqual({
      contacts: [
        {
          id: "office",
          name: "Office",
          uri: "sip:+491234567@example.com",
          comment: "work colleague",
        },
      ],
    });
  });

  it("resolves a relative agent auth file path against the config directory", async () => {
    const appConfig = createAppConfig({
      agents: [
        {
          id: "default",
          model: {
            provider: "openai",
            modelId: "gpt-5.4",
          },
          authFile: "./auth.json",
          prompt: {
            base: {
              text: "You are concise.",
            },
          },
        },
      ],
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.agents[0]?.authFile).toBe("/etc/imp/auth.json");
  });

  it("fails when no daemon endpoint is enabled", async () => {
    const appConfig = createAppConfig({
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: false,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    await expect(resolveRuntimeConfig(appConfig, "/etc/imp/config.json")).rejects.toThrowError(
      "Config must enable at least one daemon endpoint.",
    );
  });

  it("keeps more than one enabled endpoint", async () => {
    const appConfig = createAppConfig({
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
        {
          id: "ops-telegram",
          type: "telegram",
          enabled: true,
          token: "ops-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.activeEndpoints.map((endpoint) => endpoint.id)).toEqual([
      "private-telegram",
      "ops-telegram",
    ]);
  });

  it("maps enabled file endpoints into daemon runtime config", async () => {
    const appConfig = createAppConfig({
      plugins: [
        {
          id: "pi-audio",
          enabled: true,
          package: {
            path: "/opt/imp/plugins/pi-audio",
          },
        },
      ],
      endpoints: [
        {
          id: "audio-ingress",
          type: "file",
          enabled: true,
          pluginId: "pi-audio",
          routing: {
            defaultAgentId: "default",
          },
          ingress: {
            pollIntervalMs: 250,
            maxEventBytes: 65536,
          },
          response: {
            type: "outbox",
            replyChannel: {
              kind: "audio",
            },
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.activeEndpoints).toEqual([
      {
        id: "audio-ingress",
        type: "file",
        pluginId: "pi-audio",
        ingress: {
          pollIntervalMs: 250,
          maxEventBytes: 65536,
        },
        response: {
          type: "outbox",
          replyChannel: {
            kind: "audio",
          },
        },
        defaultAgentId: "default",
        paths: {
          dataRoot: "/var/lib/imp",
          conversationsDir: "/var/lib/imp/conversations",
          logsDir: "/var/lib/imp/logs/endpoints",
          logFilePath: "/var/lib/imp/logs/endpoints/audio-ingress.log",
          runtimeDir: "/var/lib/imp/runtime/endpoints",
          runtimeStatePath: "/var/lib/imp/runtime/endpoints/audio-ingress.json",
          file: {
            rootDir: "/var/lib/imp/runtime/plugins/pi-audio/endpoints/audio-ingress",
            inboxDir: "/var/lib/imp/runtime/plugins/pi-audio/endpoints/audio-ingress/inbox",
            processingDir: "/var/lib/imp/runtime/plugins/pi-audio/endpoints/audio-ingress/processing",
            processedDir: "/var/lib/imp/runtime/plugins/pi-audio/endpoints/audio-ingress/processed",
            failedDir: "/var/lib/imp/runtime/plugins/pi-audio/endpoints/audio-ingress/failed",
            outboxDir: "/var/lib/imp/runtime/plugins/pi-audio/endpoints/audio-ingress/outbox",
          },
        },
      },
    ]);
  });

  it("defaults logging level to info when logging config is omitted", async () => {
    const appConfig = createAppConfig({
      logging: undefined,
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: "telegram-token",
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");

    expect(result.logging.level).toBe("info");
  });

  it("resolves telegram token env references", async () => {
    const appConfig = createAppConfig({
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: {
            env: "IMP_TELEGRAM_BOT_TOKEN",
          },
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json", {
      env: {
        IMP_TELEGRAM_BOT_TOKEN: "telegram-from-env",
      },
    });

    const endpoint = result.activeEndpoints[0];
    expect(endpoint?.type).toBe("telegram");
    if (endpoint?.type === "telegram") {
      expect(endpoint.token).toBe("telegram-from-env");
    }
  });

  it("resolves telegram token file references relative to the config file", async () => {
    const root = await createTempDir();
    const configPath = join(root, "config", "imp.json");
    const secretPath = join(root, "config", "secrets", "telegram.token");
    await writeRawFile(secretPath, "telegram-from-file\n");

    const appConfig = createAppConfig({
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: {
            file: "./secrets/telegram.token",
          },
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, configPath);

    const endpoint = result.activeEndpoints[0];
    expect(endpoint?.type).toBe("telegram");
    if (endpoint?.type === "telegram") {
      expect(endpoint.token).toBe("telegram-from-file");
    }
  });

  it("fails when a telegram token env reference is missing", async () => {
    const appConfig = createAppConfig({
      endpoints: [
        {
          id: "private-telegram",
          type: "telegram",
          enabled: true,
          token: {
            env: "IMP_TELEGRAM_BOT_TOKEN",
          },
          access: {
            allowedUserIds: [],
          },
        },
      ],
    });

    await expect(resolveRuntimeConfig(appConfig, "/etc/imp/config.json")).rejects.toThrowError(
      "endpoints.private-telegram.token references environment variable IMP_TELEGRAM_BOT_TOKEN, but it is not set.",
    );
  });

  it("does not resolve token secrets for transports that do not define a token field", async () => {
    const transportType = "test-notoken";
    registerTransport(transportType, {
      configSchema: z.object({
        id: z.string().min(1),
        type: z.literal(transportType),
        enabled: z.boolean(),
      }),
      createTransport: () => {
        throw new Error("Not used in this test.");
      },
      normalizeRuntimeConfig: (endpoint: unknown, context: unknown) => {
        const typedBot = endpoint as { id: string; type: string };
        const typedContext = context as {
          dataRoot: string;
          defaultAgentId: string;
        };

        return {
          id: typedBot.id,
          type: typedBot.type,
        token: "runtime-token-not-required",
        allowedUserIds: [],
        defaultAgentId: typedContext.defaultAgentId,
        paths: {
          dataRoot: typedContext.dataRoot,
          conversationsDir: "/var/lib/imp/conversations",
          logsDir: "/var/lib/imp/logs/endpoints",
          logFilePath: "/var/lib/imp/logs/endpoints/no-token.log",
          runtimeDir: "/var/lib/imp/runtime/endpoints",
          runtimeStatePath: "/var/lib/imp/runtime/endpoints/no-token.json",
        },
      };
      },
    } as unknown as RegisterTransportEntry);

    const appConfig = createAppConfig({
      endpoints: [
        {
          id: "no-token",
          type: transportType,
          enabled: true,
        } as unknown as AppConfig["endpoints"][number],
      ],
    });

    const result = await resolveRuntimeConfig(appConfig, "/etc/imp/config.json");
    expect(result.activeEndpoints[0]?.id).toBe("no-token");
    expect(result.activeEndpoints[0]?.type).toBe(transportType);
  });

  it("rejects defaults.agentId when it does not reference a configured agent", () => {
    const result = appConfigSchema.safeParse(
      createAppConfig({
        defaults: {
          agentId: "missing-agent",
        },
        endpoints: [
          {
            id: "private-telegram",
            type: "telegram",
            enabled: true,
            token: "telegram-token",
            access: {
              allowedUserIds: [],
            },
          },
        ],
      }),
    );

    expectSchemaIssue(result, ["defaults", "agentId"], [
      'Unknown default agent id "missing-agent".',
      'Expected one of: "default".',
    ]);
  });

  it("rejects endpoints.routing.defaultAgentId when it does not reference a configured agent", () => {
    const result = appConfigSchema.safeParse(
      createAppConfig({
        endpoints: [
          {
            id: "private-telegram",
            type: "telegram",
            enabled: true,
            token: "telegram-token",
            access: {
              allowedUserIds: [],
            },
            routing: {
              defaultAgentId: "missing-agent",
            },
          },
        ],
      }),
    );

    expectSchemaIssue(result, ["endpoints", 0, "routing", "defaultAgentId"], [
      'Unknown default agent id "missing-agent" for endpoint "private-telegram".',
      'Expected one of: "default".',
    ]);
  });

  it("rejects duplicate agent ids", () => {
    const result = appConfigSchema.safeParse(
      createAppConfig({
        agents: [
          {
            id: "default",
            model: {
              provider: "openai",
              modelId: "gpt-5.4",
            },
            prompt: {
              base: {
                text: "You are concise.",
              },
            },
          },
          {
            id: "default",
            model: {
              provider: "openai",
              modelId: "gpt-5.4",
            },
            prompt: {
              base: {
                text: "You are also concise.",
              },
            },
          },
        ],
        endpoints: [
          {
            id: "private-telegram",
            type: "telegram",
            enabled: true,
            token: "telegram-token",
            access: {
              allowedUserIds: [],
            },
          },
        ],
      }),
    );

    expectSchemaIssue(result, ["agents", 1, "id"], [
      'Duplicate agent id "default".',
      "Agent ids must be unique.",
    ]);
  });

  it("rejects duplicate endpoint ids", () => {
    const result = appConfigSchema.safeParse(
      createAppConfig({
        endpoints: [
          {
            id: "private-telegram",
            type: "telegram",
            enabled: true,
            token: "telegram-token",
            access: {
              allowedUserIds: [],
            },
          },
          {
            id: "private-telegram",
            type: "telegram",
            enabled: true,
            token: "other-telegram-token",
            access: {
              allowedUserIds: [],
            },
          },
        ],
      }),
    );

    expectSchemaIssue(result, ["endpoints", 1, "id"], [
      'Duplicate endpoint id "private-telegram".',
      "Endpoint ids must be unique.",
    ]);
  });
});

function createAppConfig(overrides: Partial<AppConfig>): AppConfig {
  return {
    instance: {
      name: "test",
    },
    paths: {
      dataRoot: "/var/lib/imp",
      ...overrides.paths,
    },
    logging: {
      level: "info",
    },
    defaults: {
      agentId: "default",
      ...overrides.defaults,
    },
    agents: overrides.agents ?? [
      {
        id: "default",
        model: {
          provider: "openai",
          modelId: "gpt-5.4",
        },
        inference: {
          metadata: {
            app: "imp",
          },
          request: {
            store: true,
          },
        },
        tools: [],
        prompt: {
          base: {
            text: "You are concise.",
          },
        },
      },
    ],
    ...(overrides.tools ? { tools: overrides.tools } : {}),
    ...(overrides.plugins ? { plugins: overrides.plugins } : {}),
    endpoints: overrides.endpoints ?? [],
  };
}

function expectSchemaIssue(
  result: ReturnType<typeof appConfigSchema.safeParse>,
  path: Array<string | number>,
  messageParts: string[],
): void {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected schema validation to fail.");
  }

  const issue = result.error.issues.find(
    (candidate) =>
      candidate.path.length === path.length &&
      candidate.path.every((segment, index) => segment === path[index]),
  );

  expect(issue).toBeDefined();
  for (const part of messageParts) {
    expect(issue?.message).toContain(part);
  }
}

async function createTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "imp-resolve-runtime-config-test-"));
  tempDirs.push(path);
  return path;
}

async function writeRawFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

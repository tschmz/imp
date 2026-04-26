import { arch, homedir, hostname, platform, type, userInfo } from "node:os";
import { join } from "node:path";
import Handlebars from "handlebars";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext } from "../domain/conversation.js";
import type { SkillDefinition } from "../skills/types.js";
import type {
  AgentIngressContext,
  AgentInvocationContext,
  AgentOutputContext,
  ReplyChannelContext,
} from "./context.js";

export interface PromptTemplateSystemContext {
  os: string;
  platform: string;
  arch: string;
  hostname: string;
  username: string;
  homeDir: string;
}

export interface PromptTemplateRuntimeNowContext {
  iso: string;
  date: string;
  time: string;
  timeMinute: string;
  local: string;
  localMinute: string;
}

export interface PromptTemplateContext {
  system: PromptTemplateSystemContext;
  runtime: {
    now: PromptTemplateRuntimeNowContext;
    timezone: string;
  };
  invocation: {
    kind: AgentInvocationContext["kind"];
    parentAgentId: string;
    toolName: string;
  };
  ingress: {
    endpoint: {
      id: string;
    };
    transport: {
      kind: string;
    };
  };
  output: {
    mode: AgentOutputContext["mode"];
    reply: {
      channel: ReplyChannelContext;
    };
  };
  endpoint: {
    id: string;
  };
  agent: {
    id: string;
    model: {
      provider: string;
      modelId: string;
    };
    home: string;
    authFile?: string;
    workspace: {
      cwd?: string;
    };
  };
  transport: {
    kind: string;
  };
  conversation: {
    kind: string;
    metadata: Record<string, unknown>;
  };
  reply: {
    channel: ReplyChannelContext;
  };
  imp: {
    configPath?: string;
    dataRoot?: string;
    skillCatalogs?: PromptTemplateSkillCatalogContext[];
    dynamicWorkspaceSkillsPath?: string;
  };
  prompt: {
    instructions: PromptTemplateIncludedFileContext[];
    references: PromptTemplateIncludedFileContext[];
  };
  skills: PromptTemplateSkillContext[];
}

export interface PromptTemplateIncludedFileContext {
  source: string;
  content: string;
}

export interface PromptTemplateSkillContext {
  name: string;
  description: string;
  directoryPath: string;
  filePath: string;
}

export interface PromptTemplateSkillCatalogContext {
  label: string;
  path: string;
}

export function createEmptyPromptIncludedFiles(): PromptTemplateContext["prompt"] {
  return {
    instructions: [],
    references: [],
  };
}

export function mapSkillsToPromptTemplateContext(
  skills: SkillDefinition[] | undefined,
): PromptTemplateSkillContext[] {
  return (skills ?? []).map((skill) => ({
    name: skill.name,
    description: skill.description,
    directoryPath: skill.directoryPath,
    filePath: skill.filePath,
  }));
}

export function createEmptyPromptTemplateContext(): PromptTemplateContext {
  return {
    system: {
      os: "",
      platform: "",
      arch: "",
      hostname: "",
      username: "",
      homeDir: "",
    },
    runtime: {
      now: {
        iso: "",
        date: "",
        time: "",
        timeMinute: "",
        local: "",
        localMinute: "",
      },
      timezone: "",
    },
    invocation: {
      kind: "direct",
      parentAgentId: "",
      toolName: "",
    },
    ingress: {
      endpoint: {
        id: "",
      },
      transport: {
        kind: "",
      },
    },
    output: {
      mode: "reply-channel",
      reply: {
        channel: {
          kind: "",
          delivery: "none",
          endpointId: "",
        },
      },
    },
    endpoint: {
      id: "",
    },
    agent: {
      id: "",
      model: {
        provider: "",
        modelId: "",
      },
      home: "",
      authFile: "",
      workspace: {
        cwd: "",
      },
    },
    transport: {
      kind: "",
    },
    conversation: {
      kind: "",
      metadata: {},
    },
    reply: {
      channel: {
        kind: "",
        delivery: "none",
        endpointId: "",
      },
    },
    imp: {
      configPath: "",
      dataRoot: "",
      skillCatalogs: [],
      dynamicWorkspaceSkillsPath: "",
    },
    prompt: createEmptyPromptIncludedFiles(),
    skills: [],
  };
}

export function renderPromptSection(
  tagName: "INSTRUCTIONS" | "REFERENCE",
  source: string,
  content: string,
): string {
  return `<${tagName} from="${escapeInstructionAttribute(source)}">\n\n${escapeInstructionText(content)}\n</${tagName}>`;
}

export function renderPromptSections(
  tagName: "INSTRUCTIONS" | "REFERENCE",
  sections: PromptTemplateIncludedFileContext[] | undefined,
): string {
  return (sections ?? []).map((section) => renderPromptSection(tagName, section.source, section.content)).join("\n\n");
}

export function createDefaultPromptTemplateSystemContext(): PromptTemplateSystemContext {
  return {
    os: type(),
    platform: platform(),
    arch: arch(),
    hostname: hostname(),
    username: resolveUsername(),
    homeDir: homedir(),
  };
}

function resolvePromptOutputContext(options: {
  output?: AgentOutputContext;
  replyChannel?: ReplyChannelContext;
  ingress: AgentIngressContext;
}): { mode: AgentOutputContext["mode"]; replyChannel: ReplyChannelContext } {
  if (options.output?.mode === "delegated-tool") {
    return {
      mode: "delegated-tool",
      replyChannel: {
        kind: "none",
        delivery: "none",
      },
    };
  }

  const replyChannel = options.output?.replyChannel ?? options.replyChannel ?? {
    kind: options.ingress.transportKind,
    delivery: "endpoint" as const,
    endpointId: options.ingress.endpointId,
  };

  return {
    mode: "reply-channel",
    replyChannel,
  };
}


export function createPromptTemplateContext(options: {
  system: PromptTemplateSystemContext;
  agent: AgentDefinition;
  endpointId: string;
  transportKind: string;
  conversation?: ConversationContext;
  replyChannel?: ReplyChannelContext;
  invocation?: AgentInvocationContext;
  ingress?: AgentIngressContext;
  output?: AgentOutputContext;
  configPath?: string;
  dataRoot?: string;
  availableSkills?: SkillDefinition[];
  now?: Date;
  timezone?: string;
}): PromptTemplateContext {

  const invocation = options.invocation ?? {
    kind: "direct" as const,
  };
  const ingress = options.ingress ?? {
    endpointId: options.endpointId,
    transportKind: options.transportKind,
  };
  const output = resolvePromptOutputContext({
    output: options.output,
    replyChannel: options.replyChannel,
    ingress,
  });
  const skillCatalogs = resolveRuntimeSkillCatalogs(options.agent, options.dataRoot, options.conversation);
  const dynamicWorkspaceSkillsPath = resolveRuntimeWorkspaceSkillsPath(options.agent, options.conversation);

  return {
    system: options.system,
    runtime: createPromptTemplateRuntimeContext(options.now ?? new Date(), options.timezone),
    invocation: {
      kind: invocation.kind,
      parentAgentId: invocation.parentAgentId ?? "",
      toolName: invocation.toolName ?? "",
    },
    ingress: {
      endpoint: {
        id: ingress.endpointId,
      },
      transport: {
        kind: ingress.transportKind,
      },
    },
    output: {
      mode: output.mode,
      reply: {
        channel: {
          kind: output.replyChannel.kind,
          delivery: output.replyChannel.delivery,
          endpointId: output.replyChannel.endpointId ?? "",
        },
      },
    },
    endpoint: {
      id: ingress.endpointId,
    },
    agent: {
      id: options.agent.id,
      model: {
        provider: options.agent.model.provider,
        modelId: options.agent.model.modelId,
      },
      home: options.agent.home ?? "",
      authFile: options.agent.authFile ?? "",
      workspace: {
        cwd: options.agent.workspace?.cwd ?? "",
      },
    },
    transport: {
      kind: ingress.transportKind,
    },
    conversation: {
      kind: options.conversation?.state.kind ?? "",
      metadata: options.conversation?.state.metadata ?? {},
    },
    reply: {
      channel: {
        kind: output.replyChannel.kind,
        delivery: output.replyChannel.delivery,
        endpointId: output.replyChannel.endpointId ?? "",
      },
    },
    imp: {
      configPath: options.configPath ?? "",
      dataRoot: options.dataRoot ?? "",
      skillCatalogs,
      dynamicWorkspaceSkillsPath,
    },
    prompt: createEmptyPromptIncludedFiles(),
    skills: mapSkillsToPromptTemplateContext(options.availableSkills),
  };
}

function resolveRuntimeSkillCatalogs(
  agent: AgentDefinition,
  dataRoot: string | undefined,
  conversation: ConversationContext | undefined,
): PromptTemplateSkillCatalogContext[] {
  const catalogs: PromptTemplateSkillCatalogContext[] = [];

  if (dataRoot) {
    catalogs.push({
      label: "global shared catalog",
      path: join(dataRoot, "skills"),
    });
  }

  if (agent.home) {
    catalogs.push({
      label: `agent-home catalog for ${agent.id}`,
      path: join(agent.home, ".skills"),
    });
  }

  for (const path of agent.skills?.paths ?? []) {
    catalogs.push({
      label: `configured shared catalog for ${agent.id}`,
      path,
    });
  }

  const workspaceSkillsPath = resolveRuntimeWorkspaceSkillsPath(agent, conversation);
  if (workspaceSkillsPath) {
    catalogs.push({
      label: `workspace catalog for ${agent.id}`,
      path: workspaceSkillsPath,
    });
  }

  return catalogs;
}

function resolveRuntimeWorkspaceSkillsPath(
  agent: AgentDefinition,
  conversation: ConversationContext | undefined,
): string {
  const workingDirectory = conversation?.state.workingDirectory ?? agent.workspace?.cwd;
  return workingDirectory ? join(workingDirectory, ".skills") : "";
}

function createPromptTemplateRuntimeContext(
  now: Date,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
): PromptTemplateContext["runtime"] {
  const date = formatDatePart(now, timezone);
  const time = formatTimePart(now, timezone);
  const timeMinute = time.slice(0, 5);
  return {
    now: {
      iso: now.toISOString(),
      date,
      time,
      timeMinute,
      local: `${date} ${time} ${timezone}`,
      localMinute: `${date} ${timeMinute} ${timezone}`,
    },
    timezone,
  };
}

function formatDatePart(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return `${getDateTimePart(parts, "year")}-${getDateTimePart(parts, "month")}-${getDateTimePart(parts, "day")}`;
}

function formatTimePart(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return `${getDateTimePart(parts, "hour")}:${getDateTimePart(parts, "minute")}:${getDateTimePart(parts, "second")}`;
}

function getDateTimePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function renderPromptTemplate(
  template: string,
  options: {
    filePath: string;
    context: PromptTemplateContext;
  },
): string {
  try {
    return promptHandlebars.compile(template, {
      knownHelpers: PROMPT_TEMPLATE_KNOWN_HELPERS,
      knownHelpersOnly: true,
      noEscape: true,
      strict: true,
    })(options.context);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to render prompt template ${options.filePath}: ${detail}`);
  }
}

const promptHandlebars = Handlebars.create();
const PROMPT_TEMPLATE_KNOWN_HELPERS = {
  each: true,
  eq: true,
  if: true,
  instructionAttr: true,
  promptSections: true,
  instructionText: true,
  unless: true,
  with: true,
};

promptHandlebars.registerHelper("instructionAttr", (value: unknown) =>
  escapeInstructionAttribute(String(value ?? "")),
);
promptHandlebars.registerHelper(
  "promptSections",
  (tagName: unknown, sections: PromptTemplateIncludedFileContext[] | undefined) =>
    renderPromptSections(
      tagName === "REFERENCE" ? "REFERENCE" : "INSTRUCTIONS",
      sections,
    ),
);
promptHandlebars.registerHelper("instructionText", (value: unknown) =>
  escapeInstructionText(String(value ?? "")),
);
promptHandlebars.registerHelper("eq", (left: unknown, right: unknown) => left === right);

function escapeInstructionAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function escapeInstructionText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function resolveUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER ?? process.env.USERNAME ?? "";
  }
}

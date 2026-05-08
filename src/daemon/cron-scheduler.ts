import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { AgentRegistry } from "../agents/registry.js";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext, ConversationUserMessage } from "../domain/conversation.js";
import type { IncomingMessage } from "../domain/message.js";
import type { Logger } from "../logging/types.js";
import { resolveEffectiveSkills } from "../skills/resolve-effective-skills.js";
import type { DeliveryRouter } from "../transports/delivery-router.js";
import { getAgentCronPath, readAgentCronFile } from "../cron/cron-md.js";
import { getNextCronRun } from "../cron/schedule.js";
import type { AgentCronJob } from "../cron/types.js";
import type { RuntimeEntry } from "./runtime-runner.js";
import type { BootstrappedRuntime } from "./runtime-bootstrap.js";
import type { ReplyChannelContext } from "../runtime/context.js";
import {
  createDefaultPromptTemplateSystemContext,
  createPromptTemplateContext,
  renderPromptTemplate,
} from "../runtime/prompt-template.js";

interface CronSchedulerDependencies {
  agentRegistry: AgentRegistry;
  runtimes: BootstrappedRuntime[];
  deliveryRouter: DeliveryRouter;
  logger?: Logger;
  now?: () => Date;
}

interface ScheduledJobState {
  job: AgentCronJob;
  timer?: NodeJS.Timeout;
  running: boolean;
}

const pollIntervalMs = 30_000;
const maxTimerDelayMs = 2_147_483_647;

export function createCronSchedulerEntry(dependencies: CronSchedulerDependencies): RuntimeEntry {
  let stopped = false;
  let pollTimer: NodeJS.Timeout | undefined;
  const jobStates = new Map<string, ScheduledJobState>();
  const watcherCleanups: Array<() => void> = [];
  const runtime = dependencies.runtimes[0];

  return {
    async start() {
      if (!runtime) {
        return;
      }
      await loadAllJobs();
      startWatchers();
      pollTimer = setInterval(() => {
        void loadAllJobs();
      }, pollIntervalMs);

      return;
    },
    async stop() {
      stopped = true;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      for (const state of jobStates.values()) {
        if (state.timer) {
          clearTimeout(state.timer);
        }
      }
      jobStates.clear();
      for (const cleanup of watcherCleanups.splice(0)) {
        cleanup();
      }
    },
  };

  async function loadAllJobs(): Promise<void> {
    if (stopped) {
      return;
    }
    const jobs: AgentCronJob[] = [];
    for (const agent of dependencies.agentRegistry.list()) {
      if (!agent.home) {
        continue;
      }
      try {
        jobs.push(...await readAgentCronFile(agent));
      } catch (error) {
        await dependencies.logger?.error("failed to load agent cron file", {
          event: "cron.file.invalid",
          component: "cron-scheduler",
          agentId: agent.id,
          sourceFile: getAgentCronPath(agent.home),
          errorType: error instanceof Error ? error.name : typeof error,
        }, error);
      }
    }
    reconcileJobs(jobs.filter((job) => job.enabled));
  }

  function reconcileJobs(jobs: AgentCronJob[]): void {
    const nextKeys = new Set(jobs.map(jobKey));
    for (const [key, state] of jobStates) {
      if (!nextKeys.has(key)) {
        if (state.timer) {
          clearTimeout(state.timer);
        }
        jobStates.delete(key);
      }
    }
    for (const job of jobs) {
      const key = jobKey(job);
      const current = jobStates.get(key);
      if (current && JSON.stringify(current.job) === JSON.stringify(job)) {
        continue;
      }
      if (current) {
        if (current.timer) {
          clearTimeout(current.timer);
          current.timer = undefined;
        }
        current.job = job;
        if (!current.running) {
          scheduleNext(current, dependencies.now?.() ?? new Date());
        }
        continue;
      }
      const state: ScheduledJobState = { job, running: false };
      jobStates.set(key, state);
      scheduleNext(state, dependencies.now?.() ?? new Date());
    }
  }

  function scheduleNext(state: ScheduledJobState, after: Date): void {
    if (stopped || !isCurrentState(state)) {
      return;
    }
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    let nextRun;
    try {
      nextRun = getNextCronRun(state.job.schedule, {
        after,
        timezone: state.job.timezone,
        hashSeed: jobKey(state.job),
      });
    } catch (error) {
      void dependencies.logger?.error("failed to schedule cron job", {
        event: "cron.job.schedule_failed",
        component: "cron-scheduler",
        agentId: state.job.agentId,
        jobId: state.job.id,
      }, error);
      return;
    }
    const delay = Math.max(0, nextRun.getTime() - Date.now());
    if (delay > maxTimerDelayMs) {
      state.timer = setTimeout(() => {
        scheduleRunAt(state, nextRun);
      }, maxTimerDelayMs);
      return;
    }
    state.timer = setTimeout(() => {
      void runJob(state);
    }, delay);
  }

  function scheduleRunAt(state: ScheduledJobState, nextRun: Date): void {
    if (stopped || !isCurrentState(state)) {
      return;
    }
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    const delay = Math.max(0, nextRun.getTime() - Date.now());
    if (delay > maxTimerDelayMs) {
      state.timer = setTimeout(() => {
        scheduleRunAt(state, nextRun);
      }, maxTimerDelayMs);
      return;
    }
    state.timer = setTimeout(() => {
      void runJob(state);
    }, delay);
  }

  async function runJob(state: ScheduledJobState): Promise<void> {
    if (stopped || !isCurrentState(state)) {
      return;
    }
    if (state.running) {
      await dependencies.logger?.info("skipped overlapping cron job run", {
        event: "cron.job.skipped_overlap",
        component: "cron-scheduler",
        agentId: state.job.agentId,
        jobId: state.job.id,
      });
      scheduleNext(state, dependencies.now?.() ?? new Date());
      return;
    }

    state.running = true;
    const startedAt = dependencies.now?.() ?? new Date();
    try {
      await executeCronJob(state.job, startedAt);
      await dependencies.logger?.info("completed cron job", {
        event: "cron.job.completed",
        component: "cron-scheduler",
        agentId: state.job.agentId,
        jobId: state.job.id,
      });
    } catch (error) {
      await dependencies.logger?.error("failed to run cron job", {
        event: "cron.job.failed",
        component: "cron-scheduler",
        agentId: state.job.agentId,
        jobId: state.job.id,
        errorType: error instanceof Error ? error.name : typeof error,
      }, error);
    } finally {
      state.running = false;
      if (isCurrentState(state)) {
        scheduleNext(state, dependencies.now?.() ?? new Date());
      }
    }
  }

  async function executeCronJob(job: AgentCronJob, now: Date): Promise<void> {
    if (!runtime) {
      return;
    }
    const agent = dependencies.agentRegistry.get(job.agentId);
    if (!agent) {
      throw new Error(`Unknown cron agent: ${job.agentId}`);
    }
    const receivedAt = now.toISOString();
    const replyTransportKind = job.reply.type === "endpoint"
      ? getEndpointTransportKind(job.reply.endpointId)
      : undefined;
    const replyChannel = toReplyChannel(job, replyTransportKind);
    const renderedJob = renderCronJobTemplates(job, {
      agent,
      runtime,
      receivedAt,
      replyChannel,
    });
    const message = createCronIncomingMessage(renderedJob, receivedAt);
    let conversation = await runtime.conversationStore.ensureDetachedForAgent?.(message.conversation, {
      agentId: agent.id,
      now: receivedAt,
      title: renderedJob.session.title ?? renderedJob.id,
      kind: renderedJob.session.kind ?? "scheduled",
      metadata: {
        ...(renderedJob.session.metadata ?? {}),
        cronJobId: renderedJob.id,
      },
    }) ?? await runtime.conversationStore.ensureActiveForAgent?.(message.conversation, {
      agentId: agent.id,
      now: receivedAt,
      title: renderedJob.session.title ?? renderedJob.id,
    }) ?? await runtime.conversationStore.ensureActive(message.conversation, {
      agentId: agent.id,
      now: receivedAt,
      title: renderedJob.session.title ?? renderedJob.id,
    });

    const userEvent = toCronUserEvent(message);
    if (runtime.conversationStore.updateState) {
      conversation = await runtime.conversationStore.updateState(conversation, {
        updatedAt: receivedAt,
        run: {
          status: "running",
          messageId: message.messageId,
          correlationId: message.correlationId,
          startedAt: receivedAt,
          updatedAt: receivedAt,
        },
      });
    }
    if (runtime.conversationStore.appendEvents) {
      conversation = await runtime.conversationStore.appendEvents(conversation, [userEvent]);
    }

    const skills = await resolveEffectiveSkills({
      agent,
      dataRoot: runtime.endpointConfig.paths.dataRoot,
      conversation,
    });
    const result = await runtime.engine.run({
      agent,
      conversation,
      message,
      onConversationEvents: runtime.conversationStore.appendEvents
        ? async (events) => {
            conversation = await runtime.conversationStore.appendEvents!(conversation, events);
          }
        : undefined,
      onSystemPromptResolved: runtime.conversationStore.writeSystemPromptSnapshot
        ? async (snapshot) => {
            await runtime.conversationStore.writeSystemPromptSnapshot!(conversation, snapshot);
          }
        : undefined,
      runtime: {
        configPath: runtime.configPath,
        dataRoot: runtime.endpointConfig.paths.dataRoot,
        availableSkills: skills.skills,
        invocation: { kind: "direct" },
        ingress: { endpointId: message.endpointId, transportKind: message.conversation.transport },
        output: { mode: "reply-channel", replyChannel },
        replyChannel,
      },
    });

    const completedAt = (dependencies.now?.() ?? new Date()).toISOString();
    const finalConversation: ConversationContext = {
      state: {
        ...conversation.state,
        ...(result.workingDirectory ? { workingDirectory: result.workingDirectory } : {}),
        updatedAt: completedAt,
        run: { status: "idle", updatedAt: completedAt },
      },
      messages: conversation.messages,
    };
    await runtime.conversationStore.put(finalConversation);

    if (job.reply.type === "endpoint") {
      await dependencies.deliveryRouter.deliver({
        endpointId: job.reply.endpointId,
        target: job.reply.target,
        message: {
          conversation: {
            transport: replyTransportKind ?? job.reply.endpointId,
            externalId: job.reply.target.conversationId,
            endpointId: job.reply.endpointId,
          },
          text: result.message.text,
          ...(result.message.attachments ? { attachments: result.message.attachments } : {}),
        },
      });
    }
  }

  function startWatchers(): void {
    for (const agent of dependencies.agentRegistry.list()) {
      if (!agent.home) {
        continue;
      }
      void mkdir(agent.home, { recursive: true }).then(() => {
        if (stopped) {
          return;
        }
        const watcher = watch(agent.home!, (eventType, filename) => {
          if ((eventType === "change" || eventType === "rename") && filename?.toString() === "cron.md") {
            void loadAllJobs();
          }
        });
        watcherCleanups.push(() => watcher.close());
      }).catch((error: unknown) => {
        void dependencies.logger?.debug("failed to watch agent cron file", {
          event: "cron.file.watch_failed",
          component: "cron-scheduler",
          agentId: agent.id,
          sourceFile: getAgentCronPath(agent.home!),
          errorType: error instanceof Error ? error.name : typeof error,
        });
      });
    }
  }

  function isCurrentState(state: ScheduledJobState): boolean {
    return jobStates.get(jobKey(state.job)) === state;
  }

  function getEndpointTransportKind(endpointId: string): string | undefined {
    return dependencies.runtimes.find((candidate) => candidate.endpointConfig.id === endpointId)?.endpointConfig.type;
  }
}

function renderCronJobTemplates(
  job: AgentCronJob,
  options: {
    agent: AgentDefinition;
    runtime: BootstrappedRuntime;
    receivedAt: string;
    replyChannel: ReplyChannelContext;
  },
): AgentCronJob {
  const metadata = {
    ...(job.session.metadata ?? {}),
    cronJobId: job.id,
  };
  const context = createPromptTemplateContext({
    system: createDefaultPromptTemplateSystemContext(),
    agent: options.agent,
    endpointId: "cron",
    transportKind: "cron",
    conversation: {
      state: {
        conversation: {
          transport: "cron",
          externalId: `cron:${job.agentId}:${job.id}`,
          sessionId: job.session.id,
          agentId: job.agentId,
        },
        agentId: options.agent.id,
        kind: job.session.kind ?? "scheduled",
        metadata,
        createdAt: options.receivedAt,
        updatedAt: options.receivedAt,
        version: 1,
      },
      messages: [],
    },
    replyChannel: options.replyChannel,
    invocation: { kind: "direct" },
    ingress: { endpointId: "cron", transportKind: "cron" },
    output: { mode: "reply-channel", replyChannel: options.replyChannel },
    configPath: options.runtime.configPath,
    dataRoot: options.runtime.endpointConfig.paths.dataRoot,
    now: new Date(options.receivedAt),
    timezone: job.timezone,
  });
  const sessionId = renderCronTemplate(job.session.id, job, "session.id", context).trim();
  const title = job.session.title
    ? renderCronTemplate(job.session.title, job, "session.title", context).trim()
    : undefined;
  const instruction = renderCronTemplate(job.instruction, job, "instruction", context).trim();

  if (!sessionId) {
    throw new Error(`Cron job ${job.id} rendered an empty session.id.`);
  }
  if (job.session.title && !title) {
    throw new Error(`Cron job ${job.id} rendered an empty session.title.`);
  }
  if (!instruction) {
    throw new Error(`Cron job ${job.id} rendered an empty instruction.`);
  }

  return {
    ...job,
    session: {
      ...job.session,
      id: sessionId,
      ...(title ? { title } : {}),
    },
    instruction,
  };
}

function renderCronTemplate(
  template: string,
  job: AgentCronJob,
  field: "instruction" | "session.id" | "session.title",
  context: Parameters<typeof renderPromptTemplate>[1]["context"],
): string {
  return renderPromptTemplate(template, {
    filePath: `${job.sourceFile}#${job.id}.${field}`,
    context,
  });
}

function createCronIncomingMessage(job: AgentCronJob, receivedAt: string): IncomingMessage {
  const messageId = `cron:${job.agentId}:${job.id}:${randomUUID()}`;
  return {
    endpointId: "cron",
    conversation: {
      transport: "cron",
      externalId: `cron:${job.agentId}:${job.id}`,
      sessionId: job.session.id,
      agentId: job.agentId,
    },
    messageId,
    correlationId: messageId,
    userId: "cron",
    text: job.instruction,
    receivedAt,
    source: {
      kind: "scheduled",
      scheduled: {
        jobId: job.id,
        sourceFile: job.sourceFile,
      },
    },
  };
}

function toReplyChannel(job: AgentCronJob, transportKind?: string): ReplyChannelContext {
  if (job.reply.type === "none") {
    return { kind: "none", delivery: "none" };
  }
  return { kind: transportKind ?? job.reply.endpointId, delivery: "endpoint", endpointId: job.reply.endpointId };
}

function toCronUserEvent(message: IncomingMessage): ConversationUserMessage {
  return {
    id: message.messageId,
    role: "user",
    content: message.text,
    createdAt: message.receivedAt,
    correlationId: message.correlationId,
    source: message.source,
  };
}

function jobKey(job: AgentCronJob): string {
  return `${job.agentId}:${job.id}`;
}

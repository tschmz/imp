export type CronReplyConfig =
  | { type: "none" }
  | {
      type: "endpoint";
      endpointId: string;
      target: {
        conversationId: string;
        userId?: string;
      };
    };

export interface CronSessionConfig {
  mode: "detached";
  id: string;
  title?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
}

export interface CronJobDefinition {
  id: string;
  enabled: boolean;
  schedule: string;
  timezone?: string;
  reply: CronReplyConfig;
  session: CronSessionConfig;
  instruction: string;
}

export interface AgentCronJob extends CronJobDefinition {
  agentId: string;
  agentHome: string;
  sourceFile: string;
}

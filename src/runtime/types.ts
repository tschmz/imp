import type { IncomingMessage, OutgoingMessage } from "../domain/message.js";

export interface AgentRunner {
  run(message: IncomingMessage): Promise<OutgoingMessage>;
}

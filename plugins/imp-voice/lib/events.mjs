import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { writeJsonAtomic, sanitizeFileName } from "./files.mjs";

export async function writeIngressEvent(config, input) {
  const text = String(input.text ?? "").trim();
  if (!text) {
    throw new Error("Ingress event text must not be empty.");
  }

  const eventId = input.id ?? `voice-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const fileName = `${sanitizeFileName(eventId)}-${process.hrtime.bigint().toString()}.json`;
  const finalPath = join(config.inboxDir, fileName);
  await writeJsonAtomic(finalPath, {
    schemaVersion: 1,
    id: eventId,
    correlationId: input.correlationId ?? randomUUID(),
    conversationId: input.conversationId ?? config.conversationId,
    userId: input.userId ?? config.userId,
    text,
    receivedAt: new Date().toISOString(),
    metadata: {
      source: "imp-voice",
      ...(input.metadata ?? {}),
    },
  });
  return finalPath;
}

import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../lib/config.mjs";

describe("imp-phone config", () => {
  it("normalizes runtime paths and phone directories", () => {
    const runtimeDir = process.env.IMP_PHONE_RUNTIME_DIR;
    const requestsDir = process.env.IMP_PHONE_REQUESTS_DIR;
    const recordingsDir = process.env.IMP_PHONE_RECORDINGS_DIR;
    delete process.env.IMP_PHONE_RUNTIME_DIR;
    delete process.env.IMP_PHONE_REQUESTS_DIR;
    delete process.env.IMP_PHONE_RECORDINGS_DIR;
    const config = normalizeConfig(
      {
        runtimeDir: "./runtime/plugins/imp-phone/endpoints/phone-ingress",
        requestsDir: "./requests",
        recordingsDir: "./recordings",
        statusFile: "status.json",
      },
      "/tmp/imp-phone",
    );

    expect(config.runtimeDir).toBe("/tmp/imp-phone/runtime/plugins/imp-phone/endpoints/phone-ingress");
    expect(config.inboxDir).toBe("/tmp/imp-phone/runtime/plugins/imp-phone/endpoints/phone-ingress/inbox");
    expect(config.outboxDir).toBe("/tmp/imp-phone/runtime/plugins/imp-phone/endpoints/phone-ingress/outbox");
    expect(config.requestsDir).toBe("/tmp/imp-phone/requests");
    expect(config.requestProcessingDir).toBe("/tmp/imp-phone/requests/processing");
    expect(config.recordingsDir).toBe("/tmp/imp-phone/recordings");
    expect(config.statusFile).toBe("/tmp/imp-phone/runtime/plugins/imp-phone/endpoints/phone-ingress/status.json");
    expect(config.call).toMatchObject({
      command: "baresip",
      args: [],
      dialCommand: "/dial {uri}",
      registerTimeoutMs: 10000,
      answerTimeoutMs: 60000,
      maxTurns: 8,
    });
    expect(config.conversation).toMatchObject({
      responseTimeoutSeconds: 600,
      holdMessageAfterSeconds: 8,
      holdMessageIntervalSeconds: 20,
    });
    expect(config.feedbackTones).toMatchObject({
      enabled: true,
      sampleRate: 16000,
      quietAfterMs: 120,
    });
    if (runtimeDir !== undefined) {
      process.env.IMP_PHONE_RUNTIME_DIR = runtimeDir;
    }
    if (requestsDir !== undefined) {
      process.env.IMP_PHONE_REQUESTS_DIR = requestsDir;
    }
    if (recordingsDir !== undefined) {
      process.env.IMP_PHONE_RECORDINGS_DIR = recordingsDir;
    }
  });
});

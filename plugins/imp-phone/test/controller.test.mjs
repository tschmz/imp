import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PhoneController,
  isCallReadyOutput,
  parseCallFailureReason,
  parseCallProgress,
  parseContact,
  parsePurpose,
  parseRequestResultPath,
  parseRequestedAgentId,
} from "../lib/controller.mjs";
import { writeJsonAtomic } from "../lib/files.mjs";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("imp-phone controller", () => {
  it("parses call request contacts", () => {
    expect(
      parseContact({
        contact: {
          id: "thomas",
          name: "Thomas",
          uri: "+10000000000",
          comment: "work colleague",
        },
      }),
    ).toEqual({
      id: "thomas",
      name: "Thomas",
      uri: "+10000000000",
      comment: "work colleague",
    });
  });

  it("rejects malformed contacts", () => {
    expect(() => parseContact({ contact: { id: "thomas" } })).toThrow(
      "Call request contact.name must be a non-empty string.",
    );
  });

  it("parses requested agent ids", () => {
    expect(parseRequestedAgentId({ agentId: "imp.telebot" })).toBe("imp.telebot");
    expect(parseRequestedAgentId({})).toBeUndefined();
    expect(() => parseRequestedAgentId({ agentId: 42 })).toThrow(
      "Call request agentId must be a string when provided.",
    );
  });

  it("parses call purposes", () => {
    expect(parsePurpose({ purpose: "Ask about the appointment." })).toBe("Ask about the appointment.");
    expect(parsePurpose({})).toBeUndefined();
    expect(() => parsePurpose({ purpose: 42 })).toThrow("Call request purpose must be a string when provided.");
  });

  it("parses call request result paths", () => {
    expect(parseRequestResultPath({ resultPath: "/tmp/result.json" })).toBe("/tmp/result.json");
    expect(parseRequestResultPath({})).toBeUndefined();
    expect(() => parseRequestResultPath({ resultPath: 42 })).toThrow(
      "Call request resultPath must be a string when provided.",
    );
  });

  it("writes call request results", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-phone-controller-"));
    tempDirs.push(root);
    const controller = new PhoneController({
      inboxDir: join(root, "inbox"),
      outboxDir: join(root, "outbox"),
      requestsDir: join(root, "requests"),
      requestProcessingDir: join(root, "request-processing"),
      requestProcessedDir: join(root, "request-processed"),
      requestFailedDir: join(root, "request-failed"),
      controlDir: join(root, "control"),
      recordingsDir: join(root, "recordings"),
      statusFile: join(root, "status.json"),
      userId: "imp-phone",
    });
    controller.activeCall = {
      requestId: "call-1",
      conversationId: "imp-phone-call-1",
      requestedAgentId: "imp.telebot",
      purpose: "Ask about the appointment.",
      contact: {
        id: "thomas",
        name: "Thomas",
        uri: "+10000000000",
        comment: "work colleague",
      },
      answered: false,
      finalEventWritten: false,
      requestResultPath: join(root, "results", "call-1.json"),
      requestResultWritten: false,
    };

    await controller.writeRequestResult("answered");
    await controller.writeRequestResult("failed", { reason: "should not overwrite" });

    const payload = JSON.parse(await readFile(join(root, "results", "call-1.json"), "utf8"));
    expect(payload).toMatchObject({
      schemaVersion: 1,
      requestId: "call-1",
      conversationId: "imp-phone-call-1",
      status: "answered",
      contact: {
        id: "thomas",
        name: "Thomas",
        comment: "work colleague",
      },
      agentId: "imp.telebot",
      purpose: "Ask about the appointment.",
    });
    expect(payload.reason).toBeUndefined();
  });

  it("consumes hangup control commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-phone-controller-"));
    tempDirs.push(root);
    const controller = new PhoneController({
      inboxDir: join(root, "inbox"),
      outboxDir: join(root, "outbox"),
      requestsDir: join(root, "requests"),
      requestProcessingDir: join(root, "request-processing"),
      requestProcessedDir: join(root, "request-processed"),
      requestFailedDir: join(root, "request-failed"),
      controlDir: join(root, "control"),
      recordingsDir: join(root, "recordings"),
      statusFile: join(root, "status.json"),
      userId: "imp-phone",
    });

    await writeJsonAtomic(join(root, "control", "hangup.json"), {
      schemaVersion: 1,
      type: "hangup",
      reason: "conversation complete",
    });

    await expect(controller.consumeHangupCommand()).resolves.toEqual({
      reason: "conversation complete",
    });
    await expect(controller.consumeHangupCommand()).resolves.toBeUndefined();
  });

  it("surfaces persistent rename failures for matching replies", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-phone-controller-"));
    tempDirs.push(root);
    const controller = new PhoneController({
      inboxDir: join(root, "inbox"),
      outboxDir: join(root, "outbox"),
      requestsDir: join(root, "requests"),
      requestProcessingDir: join(root, "request-processing"),
      requestProcessedDir: join(root, "request-processed"),
      requestFailedDir: join(root, "request-failed"),
      controlDir: join(root, "control"),
      recordingsDir: join(root, "recordings"),
      statusFile: join(root, "status.json"),
      userId: "imp-phone",
      pollIntervalMs: 5,
      conversation: {
        responseTimeoutSeconds: 1,
        holdMessageAfterSeconds: 60,
        holdMessageIntervalSeconds: 60,
        holdMessageText: "",
      },
    });
    await controller.ensureDirs();

    await writeJsonAtomic(join(root, "outbox", "0001-match.json"), {
      eventId: "event-1",
      correlationId: "correlation-1",
      text: "matched reply",
    });
    await mkdir(join(root, "outbox", "0001-match.json.processing"));

    await expect(
      controller.waitForOutboxReply(
        { eventId: "event-1", correlationId: "correlation-1" },
        { id: "thomas", name: "Thomas", uri: "+10000000000" },
      ),
    ).rejects.toThrow("Failed to lock outbox reply 0001-match.json");
  });

  it("waits for matching outbox reply when first file does not match and second file matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-phone-controller-"));
    tempDirs.push(root);
    const controller = new PhoneController({
      inboxDir: join(root, "inbox"),
      outboxDir: join(root, "outbox"),
      requestsDir: join(root, "requests"),
      requestProcessingDir: join(root, "request-processing"),
      requestProcessedDir: join(root, "request-processed"),
      requestFailedDir: join(root, "request-failed"),
      controlDir: join(root, "control"),
      recordingsDir: join(root, "recordings"),
      statusFile: join(root, "status.json"),
      userId: "imp-phone",
      pollIntervalMs: 5,
      conversation: {
        responseTimeoutSeconds: 1,
        holdMessageAfterSeconds: 60,
        holdMessageIntervalSeconds: 60,
        holdMessageText: "",
      },
    });
    await controller.ensureDirs();

    await writeJsonAtomic(join(root, "outbox", "0001-other.json"), {
      eventId: "other-event",
      correlationId: "other-correlation",
      text: "ignore me",
    });
    await writeJsonAtomic(join(root, "outbox", "0002-match.json"), {
      eventId: "event-1",
      correlationId: "correlation-1",
      text: "matched reply",
    });

    await expect(
      controller.waitForOutboxReply(
        { eventId: "event-1", correlationId: "correlation-1" },
        { id: "thomas", name: "Thomas", uri: "+10000000000" },
      ),
    ).resolves.toMatchObject({
      text: "matched reply",
    });

    const outboxFiles = await readdir(join(root, "outbox"));
    expect(outboxFiles).toContain("0001-other.json");
  });

  it("supports ElevenLabs TTS", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-phone-controller-"));
    tempDirs.push(root);
    const previousApiKey = process.env.ELEVENLABS_API_KEY;
    process.env.ELEVENLABS_API_KEY = "test-eleven-key";
    const requests = [];
    const controller = new PhoneController({
      tts: {
        provider: "elevenlabs",
        apiKeyEnv: "ELEVENLABS_API_KEY",
        baseUrl: "https://api.elevenlabs.io",
        fallbackModel: "eleven_multilingual_v2",
        fallbackVoice: "voice-id",
        fallbackFormat: "wav_16000",
      },
    }, {
      fetchImpl: async (url, options) => {
        requests.push({
          url,
          headers: options.headers,
          body: JSON.parse(options.body),
        });
        return {
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
    });

    try {
      const audioPath = await controller.synthesize("Hallo.", {
        model: "eleven_turbo_v2_5",
        voice: "message-voice-id",
        format: "mp3_44100_128",
      });
      expect(audioPath).toContain("reply.mp3");
    } finally {
      if (previousApiKey === undefined) {
        delete process.env.ELEVENLABS_API_KEY;
      } else {
        process.env.ELEVENLABS_API_KEY = previousApiKey;
      }
    }

    expect(requests).toEqual([
      {
        url: "https://api.elevenlabs.io/v1/text-to-speech/message-voice-id?output_format=mp3_44100_128",
        headers: {
          "xi-api-key": "test-eleven-key",
          "Content-Type": "application/json",
        },
        body: {
          text: "Hallo.",
          model_id: "eleven_turbo_v2_5",
        },
      },
    ]);
  });

  it("ignores OpenAI speech metadata for ElevenLabs TTS", async () => {
    const previousApiKey = process.env.ELEVENLABS_API_KEY;
    process.env.ELEVENLABS_API_KEY = "test-eleven-key";
    const requests = [];
    const controller = new PhoneController({
      tts: {
        provider: "elevenlabs",
        apiKeyEnv: "ELEVENLABS_API_KEY",
        baseUrl: "https://api.elevenlabs.io",
        fallbackModel: "eleven_multilingual_v2",
        fallbackVoice: "fallback-voice-id",
        fallbackFormat: "wav_16000",
      },
    }, {
      fetchImpl: async (url, options) => {
        requests.push({
          url,
          body: JSON.parse(options.body),
        });
        return {
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
    });

    try {
      await controller.synthesize("Hallo.", {
        model: "gpt-4o-mini-tts",
        voice: "nova",
      });
    } finally {
      if (previousApiKey === undefined) {
        delete process.env.ELEVENLABS_API_KEY;
      } else {
        process.env.ELEVENLABS_API_KEY = previousApiKey;
      }
    }

    expect(requests).toEqual([
      {
        url: "https://api.elevenlabs.io/v1/text-to-speech/fallback-voice-id?output_format=wav_16000",
        body: {
          text: "Hallo.",
          model_id: "eleven_multilingual_v2",
        },
      },
    ]);
  });

  it("writes a final no-response ingress event when an answered call closes", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-phone-controller-"));
    tempDirs.push(root);
    const controller = new PhoneController({
      inboxDir: join(root, "inbox"),
      outboxDir: join(root, "outbox"),
      requestsDir: join(root, "requests"),
      requestProcessingDir: join(root, "request-processing"),
      requestProcessedDir: join(root, "request-processed"),
      requestFailedDir: join(root, "request-failed"),
      controlDir: join(root, "control"),
      recordingsDir: join(root, "recordings"),
      statusFile: join(root, "status.json"),
      userId: "imp-phone",
    });
    await controller.ensureDirs();
    controller.activeCall = {
      requestId: "call-1",
      conversationId: "imp-phone-call-1",
      requestedAgentId: "imp.telebot",
      purpose: "Ask about the appointment.",
      contact: {
        id: "thomas",
        name: "Thomas",
        uri: "+10000000000",
        comment: "work colleague",
      },
      answered: true,
      finalEventWritten: false,
    };

    await controller.closeCall("close-phrase", { transcript: "Gespräch beendet" });

    const [fileName] = await readdir(join(root, "inbox"));
    const payload = JSON.parse(await readFile(join(root, "inbox", fileName), "utf8"));
    expect(payload).toMatchObject({
      id: "call-1-closed",
      conversationId: "imp-phone-call-1",
      response: {
        type: "none",
      },
      session: {
        mode: "detached",
        id: "imp-phone-call-1",
        agentId: "imp.telebot",
        kind: "phone-call",
        metadata: {
          phone_call_event: "call_closed",
          closed_reason: "close-phrase",
          phone_call_purpose: "Ask about the appointment.",
          contact_id: "thomas",
          contact_name: "Thomas",
          contact_comment: "work colleague",
        },
      },
      metadata: {
        phone_call_event: "call_closed",
        closed_reason: "close-phrase",
        transcript: "Gespräch beendet",
      },
    });
    expect(payload.text).toContain("Finalize the contact notes now");
  });

  it("skips malformed outbox files and keeps waiting for a valid reply", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-phone-controller-"));
    tempDirs.push(root);
    const logMessages = [];
    const controller = new PhoneController({
      inboxDir: join(root, "inbox"),
      outboxDir: join(root, "outbox"),
      requestsDir: join(root, "requests"),
      requestProcessingDir: join(root, "request-processing"),
      requestProcessedDir: join(root, "request-processed"),
      requestFailedDir: join(root, "request-failed"),
      controlDir: join(root, "control"),
      recordingsDir: join(root, "recordings"),
      statusFile: join(root, "status.json"),
      userId: "imp-phone",
      pollIntervalMs: 5,
      conversation: {
        responseTimeoutSeconds: 1,
        holdMessageAfterSeconds: 3600,
        holdMessageIntervalSeconds: 3600,
      },
    }, {
      log: (message) => logMessages.push(message),
    });
    await controller.ensureDirs();
    await writeFile(join(root, "outbox", "000-bad.json"), "{ invalid-json");
    await writeJsonAtomic(join(root, "outbox", "001-good.json"), {
      eventId: "event-1",
      text: "Valid reply",
      speech: {
        model: "gpt-4o-mini-tts",
      },
    });

    const reply = await controller.waitForOutboxReply(
      { eventId: "event-1", correlationId: "corr-1", conversationId: "conv-1" },
      { id: "thomas", name: "Thomas", uri: "sip:thomas@example.com" },
    );

    expect(reply).toEqual({
      text: "Valid reply",
      speech: {
        model: "gpt-4o-mini-tts",
      },
    });
    expect(logMessages.some((message) => message.includes("could not be parsed and was quarantined"))).toBe(true);
    await expect(readFile(join(root, "outbox", "000-bad.json"), "utf8")).rejects.toThrow();
    const quarantineError = JSON.parse(await readFile(join(root, "outbox", "000-bad.json.failed.error"), "utf8"));
    expect(quarantineError.error).toContain("JSON");
  });

  it("waits for in-progress outbox writes instead of quarantining immediately", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-phone-controller-"));
    tempDirs.push(root);
    const controller = new PhoneController({
      inboxDir: join(root, "inbox"),
      outboxDir: join(root, "outbox"),
      requestsDir: join(root, "requests"),
      requestProcessingDir: join(root, "request-processing"),
      requestProcessedDir: join(root, "request-processed"),
      requestFailedDir: join(root, "request-failed"),
      controlDir: join(root, "control"),
      recordingsDir: join(root, "recordings"),
      statusFile: join(root, "status.json"),
      userId: "imp-phone",
      pollIntervalMs: 5,
      conversation: {
        responseTimeoutSeconds: 1,
        holdMessageAfterSeconds: 3600,
        holdMessageIntervalSeconds: 3600,
      },
    });
    await controller.ensureDirs();

    const replyPath = join(root, "outbox", "000-reply.json");
    await writeFile(replyPath, "{\"eventId\":\"event-1\",\"text\":\"partial");
    setTimeout(async () => {
      await writeFile(replyPath, "{\"eventId\":\"event-1\",\"correlationId\":\"corr-1\",\"text\":\"Valid reply\"}");
    }, 10);

    const reply = await controller.waitForOutboxReply(
      { eventId: "event-1", correlationId: "corr-1", conversationId: "conv-1" },
      { id: "thomas", name: "Thomas", uri: "sip:thomas@example.com" },
    );

    expect(reply).toEqual({
      text: "Valid reply",
      speech: {},
    });
    await expect(readFile(`${replyPath}.failed.error`, "utf8")).rejects.toThrow();
  });

  it("extracts SIP call failure reasons from call output", () => {
    expect(parseCallFailureReason("sip:example: session closed: 488 Not Acceptable Here")).toBe(
      "488 Not Acceptable Here",
    );
    expect(parseCallFailureReason("call: SIP Progress: 486 Busy Here (/)")).toBe("486 Busy Here (/)");
    expect(parseCallFailureReason("call: SIP Progress: 100 Trying (/)")).toBeUndefined();
  });

  it("detects when baresip is registered before dialing", () => {
    expect(isCallReadyOutput("All 1 useragent registered successfully! (480 ms)")).toBe(true);
    expect(isCallReadyOutput("4942149171719@sip.alice-voip.de: (prio 0) {0/UDP/v6} 200 OK () [1 binding]")).toBe(
      true,
    );
    expect(isCallReadyOutput("baresip is ready.")).toBe(false);
  });

  it("extracts SIP call progress states from call output", () => {
    expect(parseCallProgress("call: SIP Progress: 180 Ringing (/)")).toBe("ringing");
    expect(parseCallProgress("call: SIP Progress: 183 Session Progress (/)")).toBe("ringing");
    expect(parseCallProgress("call: SIP Progress: 200 OK (/)")).toBe("answered");
    expect(parseCallProgress("call established")).toBe("answered");
    expect(parseCallProgress("session closed: Normal clearing")).toBe("closed");
    expect(parseCallProgress("call: SIP Progress: 100 Trying (/)")).toBeUndefined();
  });
});

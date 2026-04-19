import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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
  parseRequestedAgentId,
} from "../lib/controller.mjs";

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

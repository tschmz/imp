import { describe, expect, it } from "vitest";
import {
  isCallReadyOutput,
  parseCallFailureReason,
  parseCallProgress,
  parseContact,
  parseRequestedAgentId,
} from "../lib/controller.mjs";

describe("imp-phone controller", () => {
  it("parses call request contacts", () => {
    expect(
      parseContact({
        contact: {
          id: "thomas",
          name: "Thomas",
          uri: "+10000000000",
        },
      }),
    ).toEqual({
      id: "thomas",
      name: "Thomas",
      uri: "+10000000000",
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

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeCallRequest } from "../lib/requests.mjs";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("imp-phone call requests", () => {
  it("writes an allowlisted contact request file", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-phone-request-"));
    tempDirs.push(root);

    const path = await writeCallRequest({
      requestsDir: root,
      id: "call-1",
      correlationId: "corr-1",
      contactId: "thomas",
      contactName: "Thomas",
      uri: "+10000000000",
      comment: "work colleague",
      agentId: "imp.telebot",
      purpose: "Test call",
    });

    const payload = JSON.parse(await readFile(path, "utf8"));
    expect(payload).toMatchObject({
      schemaVersion: 1,
      id: "call-1",
      correlationId: "corr-1",
      contact: {
        id: "thomas",
        name: "Thomas",
        uri: "+10000000000",
        comment: "work colleague",
      },
      agentId: "imp.telebot",
      purpose: "Test call",
    });
    expect(payload.requestedAt).toEqual(expect.any(String));
  });

  it("uses the phone agent environment variable when no agent id argument is provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-phone-request-"));
    tempDirs.push(root);
    const previousAgentId = process.env.IMP_PHONE_AGENT_ID;
    const previousComment = process.env.IMP_PHONE_CONTACT_COMMENT;
    process.env.IMP_PHONE_AGENT_ID = "imp.telebot";
    process.env.IMP_PHONE_CONTACT_COMMENT = "work colleague";

    try {
      const path = await writeCallRequest({
        requestsDir: root,
        id: "call-1",
        contactId: "thomas",
        contactName: "Thomas",
        uri: "+10000000000",
      });

      const payload = JSON.parse(await readFile(path, "utf8"));
      expect(payload.agentId).toBe("imp.telebot");
      expect(payload.contact.comment).toBe("work colleague");
    } finally {
      if (previousAgentId === undefined) {
        delete process.env.IMP_PHONE_AGENT_ID;
      } else {
        process.env.IMP_PHONE_AGENT_ID = previousAgentId;
      }
      if (previousComment === undefined) {
        delete process.env.IMP_PHONE_CONTACT_COMMENT;
      } else {
        process.env.IMP_PHONE_CONTACT_COMMENT = previousComment;
      }
    }
  });
});

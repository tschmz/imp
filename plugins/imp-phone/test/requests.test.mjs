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
      },
      purpose: "Test call",
    });
    expect(payload.requestedAt).toEqual(expect.any(String));
  });
});

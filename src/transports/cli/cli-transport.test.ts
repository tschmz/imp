import { describe, expect, it } from "vitest";
import { shouldApplyCliAgentResolution } from "./cli-transport.js";

describe("CLI transport", () => {
  it("ignores stale agent resolutions from older non-command responses", () => {
    expect(
      shouldApplyCliAgentResolution({
        activeAgentRevisionAtSubmit: 0,
        currentActiveAgentRevision: 1,
      }),
    ).toBe(false);
  });

  it("applies explicit agent command resolutions even after concurrent messages", () => {
    expect(
      shouldApplyCliAgentResolution({
        command: "agent",
        activeAgentRevisionAtSubmit: 0,
        currentActiveAgentRevision: 1,
      }),
    ).toBe(true);
  });

  it("applies non-command agent resolutions when no newer agent switch happened", () => {
    expect(
      shouldApplyCliAgentResolution({
        activeAgentRevisionAtSubmit: 1,
        currentActiveAgentRevision: 1,
      }),
    ).toBe(true);
  });
});

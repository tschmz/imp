import { describe, expect, it, vi } from "vitest";
import { createRoutingLogger } from "./routing-logger.js";
import type { Logger } from "./types.js";

describe("createRoutingLogger", () => {
  it("routes endpoint logs to the endpoint logger", async () => {
    const endpointLogger = createMockLogger();
    const agentLogger = createMockLogger();
    const logger = createRoutingLogger(endpointLogger, {
      forAgent: vi.fn(() => agentLogger),
    });

    await logger.info("received telegram message", {
      endpointId: "private-telegram",
      agentId: "default",
    });

    expect(endpointLogger.info).toHaveBeenCalledWith("received telegram message", {
      endpointId: "private-telegram",
      agentId: "default",
    });
    expect(agentLogger.info).not.toHaveBeenCalled();
  });

  it("routes agent pipeline logs to the agent logger", async () => {
    const endpointLogger = createMockLogger();
    const agentLogger = createMockLogger();
    const forAgent = vi.fn(() => agentLogger);
    const logger = createRoutingLogger(endpointLogger, { forAgent });

    await logger.debug("agent-engine.pipeline", {
      endpointId: "private-telegram",
      agentId: "default",
      correlationId: "corr-1",
    });

    expect(forAgent).toHaveBeenCalledWith("default");
    expect(agentLogger.debug).toHaveBeenCalledWith("agent-engine.pipeline", {
      endpointId: "private-telegram",
      agentId: "default",
      correlationId: "corr-1",
    });
    expect(endpointLogger.debug).not.toHaveBeenCalled();
  });
});

function createMockLogger(): Logger {
  return {
    debug: vi.fn(async () => undefined),
    info: vi.fn(async () => undefined),
    error: vi.fn(async () => undefined),
  };
}

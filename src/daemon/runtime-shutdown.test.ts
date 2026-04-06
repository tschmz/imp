import { describe, expect, it, vi } from "vitest";
import { createRuntimeShutdown } from "./runtime-shutdown.js";

describe("createRuntimeShutdown", () => {
  it("exits with a non-zero code when a control action is requested", async () => {
    const stop = vi.fn(async () => {});
    const exit = vi.fn((() => undefined) as never);

    const shutdown = createRuntimeShutdown(
      [
        {
          start: vi.fn(async () => {}),
          stop,
        },
      ],
      [],
      {
        once() {},
        off() {},
        exit,
      },
    );

    shutdown.requestControlAction("reload");
    await vi.waitFor(() => {
      expect(stop).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledWith(75);
    });
  });

  it("shuts down and exits on SIGTERM", async () => {
    const stop = vi.fn(async () => {});
    const exit = vi.fn((() => undefined) as never);
    let handleSigterm: (() => void) | undefined;

    const shutdown = createRuntimeShutdown(
      [
        {
          start: vi.fn(async () => {}),
          stop,
        },
      ],
      [],
      {
        once(event, listener) {
          if (event === "SIGTERM") {
            handleSigterm = listener;
          }
        },
        off() {},
        exit,
      },
    );

    shutdown.registerSignalHandlers();
    handleSigterm?.();

    await vi.waitFor(() => {
      expect(stop).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledWith(0);
    });
  });
});

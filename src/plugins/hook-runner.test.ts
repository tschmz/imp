import { describe, expect, it, vi } from "vitest";
import { createHookRunner } from "./hook-runner.js";

describe("createHookRunner", () => {
  it("is a no-op when no hooks are registered", async () => {
    const runner = createHookRunner<{ onStart?(context: { id: string }): void }>();

    await expect(
      runner.run("onStart", (hooks) => hooks.onStart, { id: "1" }),
    ).resolves.toBeUndefined();
  });

  it("runs matching hooks in registration order", async () => {
    const calls: string[] = [];
    const runner = createHookRunner([
      {
        name: "first",
        hooks: {
          onStart: () => {
            calls.push("first");
          },
        },
      },
      {
        name: "second",
        hooks: {
          onStart: () => {
            calls.push("second");
          },
        },
      },
    ]);

    await runner.run("onStart", (hooks) => hooks.onStart, { id: "1" });

    expect(calls).toEqual(["first", "second"]);
  });

  it("logs and rethrows normal hook failures", async () => {
    const logger = {
      debug: vi.fn(async () => {}),
      info: vi.fn(async () => {}),
      error: vi.fn(async () => {}),
    };
    const failure = new Error("boom");
    const runner = createHookRunner(
      [
        {
          name: "bad-hook",
          hooks: {
            onStart: () => {
              throw failure;
            },
          },
        },
      ],
      { logger },
    );

    await expect(
      runner.run("onStart", (hooks) => hooks.onStart, { id: "1" }),
    ).rejects.toThrow(failure);
    expect(logger.error).toHaveBeenCalledWith(
      "plugin hook failed",
      {
        hookName: "onStart",
        hookRegistrationName: "bad-hook",
        errorType: "Error",
      },
      failure,
    );
  });

  it("logs but does not rethrow error hook failures", async () => {
    const logger = {
      debug: vi.fn(async () => {}),
      info: vi.fn(async () => {}),
      error: vi.fn(async () => {}),
    };
    const failure = new Error("hook cleanup failed");
    const runner = createHookRunner(
      [
        {
          name: "bad-error-hook",
          hooks: {
            onError: () => {
              throw failure;
            },
          },
        },
      ],
      { logger },
    );

    await expect(
      runner.runErrorHook("onError", (hooks) => hooks.onError, { id: "1" }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "plugin hook failed",
      {
        hookName: "onError",
        hookRegistrationName: "bad-error-hook",
        errorType: "Error",
      },
      failure,
    );
  });
});

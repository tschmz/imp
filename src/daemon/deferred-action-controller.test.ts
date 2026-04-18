import { describe, expect, it, vi } from "vitest";
import { createDeferredActionController } from "./deferred-action-controller.js";

describe("createDeferredActionController", () => {
  it("queues action requests before initialization and flushes them in order", () => {
    const controller = createDeferredActionController<"reload" | "restart">();
    const handler = vi.fn<(action: "reload" | "restart") => void>();

    controller.request("reload");
    controller.request("restart");

    expect(handler).not.toHaveBeenCalled();

    controller.setHandler(handler);

    expect(handler).toHaveBeenNthCalledWith(1, "reload");
    expect(handler).toHaveBeenNthCalledWith(2, "restart");
  });

  it("forwards action requests immediately after initialization", () => {
    const controller = createDeferredActionController<"reload" | "restart">();
    const handler = vi.fn<(action: "reload" | "restart") => void>();

    controller.setHandler(handler);
    controller.request("reload");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("reload");
  });
});

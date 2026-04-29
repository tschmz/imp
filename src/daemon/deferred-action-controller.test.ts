import { describe, expect, it, vi } from "vitest";
import { createDeferredActionController } from "./deferred-action-controller.js";

describe("createDeferredActionController", () => {
  it("queues action requests before initialization, then forwards later requests immediately", () => {
    const controller = createDeferredActionController<"reload" | "restart">();
    const handler = vi.fn<(action: "reload" | "restart") => void>();

    controller.request("reload");
    controller.request("restart");

    expect(handler).not.toHaveBeenCalled();

    controller.setHandler(handler);

    expect(handler).toHaveBeenNthCalledWith(1, "reload");
    expect(handler).toHaveBeenNthCalledWith(2, "restart");

    controller.request("reload");

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenNthCalledWith(3, "reload");
  });
});

import { describe, expect, it } from "vitest";
import { toUserVisibleToolError } from "./user-visible-tool-error.js";

describe("toUserVisibleToolError", () => {
  it("maps spawn-time ENOENT failures to command execution errors by default", () => {
    const error = Object.assign(new Error("spawn rg ENOENT"), { code: "ENOENT" });

    expect(toUserVisibleToolError(error, {
      fallbackMessage: "Built-in tool failed.",
      defaultKind: "tool_command_execution",
    })).toMatchObject({
      kind: "tool_command_execution",
      message: "spawn rg ENOENT",
    });
  });

  it("still maps missing path file operations to file persistence errors", () => {
    const error = Object.assign(new Error("ENOENT: no such file or directory, stat '/workspace/missing'"), {
      code: "ENOENT",
    });

    expect(toUserVisibleToolError(error, {
      fallbackMessage: "File operation failed.",
      defaultKind: "tool_command_execution",
    })).toMatchObject({
      kind: "file_document_persistence",
      message: "ENOENT: no such file or directory, stat '/workspace/missing'",
    });
  });
});

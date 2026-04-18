import { describe, expect, it } from "vitest";
import {
  ConfigAlreadyExistsError,
  ConfigurationError,
  MissingPluginPackagePathError,
  PluginAlreadyConfiguredError,
  PluginNotConfiguredError,
  PluginNotFoundError,
} from "./domain/errors.js";
import { normalizeCliError } from "./main.js";

describe("normalizeCliError", () => {
  it("maps typed user-facing configuration errors to configuration output", () => {
    const errors = [
      new PluginNotFoundError("imp-voice"),
      new PluginAlreadyConfiguredError("imp-voice"),
      new PluginNotConfiguredError("imp-voice"),
      new MissingPluginPackagePathError("imp-voice"),
      new ConfigAlreadyExistsError("/tmp/imp/config.json"),
      new ConfigurationError("invalid config"),
    ];

    for (const error of errors) {
      expect(normalizeCliError(error)).toMatchObject({
        label: "Configuration error",
        exitCode: 2,
      });
    }
  });

  it("maps unknown errors to unexpected output", () => {
    expect(normalizeCliError(new Error("boom"))).toEqual({
      label: "Unexpected error",
      message: "boom",
      exitCode: 1,
    });
  });
});

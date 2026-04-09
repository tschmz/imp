import { describe, expect, it } from "vitest";
import { resolveSecretValue, secretValueConfigSchema } from "./secret-value.js";

describe("secretValueConfigSchema", () => {
  it("accepts inline strings and explicit env/file references", () => {
    expect(secretValueConfigSchema.parse("telegram-token")).toBe("telegram-token");
    expect(secretValueConfigSchema.parse({ env: "IMP_TELEGRAM_BOT_TOKEN" })).toEqual({
      env: "IMP_TELEGRAM_BOT_TOKEN",
    });
    expect(secretValueConfigSchema.parse({ file: "./secrets/telegram.token" })).toEqual({
      file: "./secrets/telegram.token",
    });
  });

  it("rejects references that specify both env and file", () => {
    const result = secretValueConfigSchema.safeParse({
      env: "IMP_TELEGRAM_BOT_TOKEN",
      file: "./secrets/telegram.token",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected schema validation to fail.");
    }

    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        message: "Specify exactly one of env or file.",
      }),
    );
  });
});

describe("resolveSecretValue", () => {
  it("returns inline strings unchanged", async () => {
    await expect(
      resolveSecretValue("telegram-token", {
        configDir: "/etc/imp",
        fieldLabel: "bots.0.token",
      }),
    ).resolves.toBe("telegram-token");
  });

  it("resolves env references", async () => {
    await expect(
      resolveSecretValue(
        {
          env: "IMP_TELEGRAM_BOT_TOKEN",
        },
        {
          configDir: "/etc/imp",
          env: {
            IMP_TELEGRAM_BOT_TOKEN: "telegram-from-env",
          },
          fieldLabel: "bots.0.token",
        },
      ),
    ).resolves.toBe("telegram-from-env");
  });

  it("fails when an env reference is missing", async () => {
    await expect(
      resolveSecretValue(
        {
          env: "IMP_TELEGRAM_BOT_TOKEN",
        },
        {
          configDir: "/etc/imp",
          env: {},
          fieldLabel: "bots.0.token",
        },
      ),
    ).rejects.toThrow(
      "bots.0.token references environment variable IMP_TELEGRAM_BOT_TOKEN, but it is not set.",
    );
  });

  it("reads file references and strips one trailing newline", async () => {
    await expect(
      resolveSecretValue(
        {
          file: "./secrets/telegram.token",
        },
        {
          configDir: "/etc/imp",
          readTextFile: async (path) => {
            expect(path).toBe("/etc/imp/secrets/telegram.token");
            return "telegram-from-file\n";
          },
          fieldLabel: "bots.0.token",
        },
      ),
    ).resolves.toBe("telegram-from-file");
  });

  it("fails when a secret file cannot be read", async () => {
    await expect(
      resolveSecretValue(
        {
          file: "./secrets/telegram.token",
        },
        {
          configDir: "/etc/imp",
          readTextFile: async () => {
            throw new Error("ENOENT: no such file or directory");
          },
          fieldLabel: "bots.0.token",
        },
      ),
    ).rejects.toThrow(
      "bots.0.token references secret file /etc/imp/secrets/telegram.token, but it could not be read: ENOENT: no such file or directory",
    );
  });

  it("fails when a secret file is empty after newline normalization", async () => {
    await expect(
      resolveSecretValue(
        {
          file: "./secrets/telegram.token",
        },
        {
          configDir: "/etc/imp",
          readTextFile: async () => "\n",
          fieldLabel: "bots.0.token",
        },
      ),
    ).rejects.toThrow(
      "bots.0.token references secret file /etc/imp/secrets/telegram.token, but it is empty.",
    );
  });
});

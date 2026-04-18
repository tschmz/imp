import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeConfig } from "../lib/config.mjs";
import { SpeakerOutboxConsumer, isExpired } from "../lib/speaker.mjs";

describe("imp-voice speaker outbox", () => {
  it("processes silent outbox replies without TTS", async () => {
    const root = await createTempRoot();
    const config = normalizeConfig({ runtimeDir: join(root, "runtime") }, root);
    await mkdir(config.outboxDir, { recursive: true });
    await writeFile(
      join(config.outboxDir, "reply.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        text: "Do not speak.",
        speech: {
          enabled: false,
        },
      })}\n`,
      "utf8",
    );
    const consumer = new SpeakerOutboxConsumer(config, {
      once: true,
      playAudio: false,
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      },
      log: () => undefined,
    });

    await expect(consumer.run()).resolves.toBe(0);

    expect(await readdir(config.outboxDir)).toEqual([]);
    expect(await readdir(config.speaker.processedDir)).toHaveLength(1);
    const status = JSON.parse(await readFile(config.speaker.statusFile, "utf8"));
    expect(status).toMatchObject({
      service: "imp-voice-out",
      status: "processed",
      text: "Do not speak.",
    });
  });

  it("sends outbox speech metadata to TTS before using local fallbacks", async () => {
    const root = await createTempRoot();
    const previousApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    const bodies = [];
    const config = normalizeConfig(
      {
        runtimeDir: join(root, "runtime"),
        speaker: {
          tts: {
            fallbackModel: "fallback-model",
            fallbackVoice: "fallback-voice",
            fallbackFormat: "mp3",
          },
        },
      },
      root,
    );
    await mkdir(config.outboxDir, { recursive: true });
    await writeFile(
      join(config.outboxDir, "reply.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        text: "Hello.",
        speech: {
          model: "message-model",
          voice: "message-voice",
          instructions: "Use a quiet tone.",
        },
      })}\n`,
      "utf8",
    );
    const consumer = new SpeakerOutboxConsumer(config, {
      once: true,
      playAudio: false,
      fetchImpl: async (_url, options) => {
        bodies.push(JSON.parse(options.body));
        return {
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
      log: () => undefined,
    });

    try {
      await expect(consumer.run()).resolves.toBe(0);
    } finally {
      if (previousApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousApiKey;
      }
    }

    expect(bodies).toEqual([
      {
        model: "message-model",
        voice: "message-voice",
        input: "Hello.",
        response_format: "mp3",
        instructions: "Use a quiet tone.",
      },
    ]);
  });

  it("detects expired replies", () => {
    expect(
      isExpired({
        ttlMs: 1,
        createdAt: "2000-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      isExpired({
        ttlMs: 60_000,
        createdAt: new Date().toISOString(),
      }),
    ).toBe(false);
  });
});

let tempRoots = [];

async function createTempRoot() {
  const root = await mkdtemp(join(tmpdir(), "imp-voice-speaker-test-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.map((path) => rm(path, { recursive: true, force: true })));
  tempRoots = [];
});

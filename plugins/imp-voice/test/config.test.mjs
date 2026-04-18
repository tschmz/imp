import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../lib/config.mjs";

describe("imp-voice config", () => {
  it("normalizes runtime paths and speaker directories", () => {
    const config = normalizeConfig(
      {
        runtimeDir: "./runtime/plugins/imp-voice/endpoints/audio-ingress",
        speaker: {
          processingDir: "speaker-processing",
          statusFile: "speaker-status.json",
        },
      },
      "/tmp/imp-config",
    );

    expect(config.runtimeDir).toBe("/tmp/imp-config/runtime/plugins/imp-voice/endpoints/audio-ingress");
    expect(config.inboxDir).toBe("/tmp/imp-config/runtime/plugins/imp-voice/endpoints/audio-ingress/inbox");
    expect(config.outboxDir).toBe("/tmp/imp-config/runtime/plugins/imp-voice/endpoints/audio-ingress/outbox");
    expect(config.speaker.processingDir).toBe(
      "/tmp/imp-config/runtime/plugins/imp-voice/endpoints/audio-ingress/speaker-processing",
    );
    expect(config.speaker.statusFile).toBe(
      "/tmp/imp-config/runtime/plugins/imp-voice/endpoints/audio-ingress/speaker-status.json",
    );
    expect(config.speaker.tts).toMatchObject({
      fallbackModel: "gpt-4o-mini-tts",
      fallbackVoice: "nova",
      fallbackInstructions: "",
      fallbackFormat: "wav",
    });
  });
});

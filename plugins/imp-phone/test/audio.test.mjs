import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildFeedbackTone, calculateRms, renderArgs, renderTemplate, writeWav } from "../lib/audio.mjs";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("imp-phone audio helpers", () => {
  it("renders command templates", () => {
    expect(renderTemplate("/dial {uri}", { uri: "+10000000000" })).toBe("/dial +10000000000");
    expect(
      renderArgs(["--contact", "{contactId}", "--name", "{contactName}"], {
        contactId: "thomas",
        contactName: "Thomas",
      }),
    ).toEqual(["--contact", "thomas", "--name", "Thomas"]);
  });

  it("calculates rms for signed 16-bit PCM", () => {
    const buffer = Buffer.alloc(4);
    buffer.writeInt16LE(1000, 0);
    buffer.writeInt16LE(-1000, 2);

    expect(calculateRms(buffer)).toBe(1000);
  });

  it("writes a wav header and pcm data", async () => {
    const root = await mkdtemp(join(tmpdir(), "imp-phone-wav-"));
    tempDirs.push(root);
    const path = join(root, "turn.wav");
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(100, 0);
    pcm.writeInt16LE(-100, 2);

    await writeWav(path, pcm, { sampleRate: 16000, channels: 1 });

    const wav = await readFile(path);
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.readUInt32LE(40)).toBe(4);
    expect(wav.subarray(44)).toEqual(pcm);
  });

  it("builds phone feedback tones", () => {
    const tone = buildFeedbackTone("captured", { sampleRate: 16000 });

    expect(tone.durationSeconds).toBeGreaterThan(0);
    expect(tone.pcm.length).toBeGreaterThan(0);
    expect(() => buildFeedbackTone("missing")).toThrow("Unknown feedback tone: missing");
  });
});

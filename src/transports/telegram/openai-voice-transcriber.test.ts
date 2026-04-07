import { describe, expect, it, vi } from "vitest";
import { createOpenAiVoiceTranscriber } from "./openai-voice-transcriber.js";

describe("createOpenAiVoiceTranscriber", () => {
  it("sends multipart audio to the OpenAI transcription endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ text: "hello from audio" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
    const transcriber = createOpenAiVoiceTranscriber({
      fetch: fetchMock,
      apiKey: "test-key",
    });

    const result = await transcriber.transcribe({
      audio: new Uint8Array([1, 2, 3]),
      fileName: "voice.ogg",
      mimeType: "audio/ogg",
      config: {
        provider: "openai",
        model: "gpt-4o-mini-transcribe",
        language: "en",
      },
    });

    expect(result).toEqual({ text: "hello from audio" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-key",
        },
        body: expect.any(FormData),
      }),
    );
  });

  it("fails when OPENAI_API_KEY is unavailable", async () => {
    const transcriber = createOpenAiVoiceTranscriber({
      apiKey: "",
      fetch: vi.fn(),
    });

    await expect(
      transcriber.transcribe({
        audio: new Uint8Array([1, 2, 3]),
        fileName: "voice.ogg",
        mimeType: "audio/ogg",
        config: {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
        },
      }),
    ).rejects.toThrow("Voice transcription requires OPENAI_API_KEY.");
  });

  it("surfaces API failures with the returned provider message", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: { message: "bad audio" } }), {
        status: 400,
        statusText: "Bad Request",
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
    const transcriber = createOpenAiVoiceTranscriber({
      fetch: fetchMock,
      apiKey: "test-key",
    });

    await expect(
      transcriber.transcribe({
        audio: new Uint8Array([1, 2, 3]),
        fileName: "voice.ogg",
        mimeType: "audio/ogg",
        config: {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
        },
      }),
    ).rejects.toThrow("OpenAI transcription request failed (400 Bad Request: bad audio).");
  });
});

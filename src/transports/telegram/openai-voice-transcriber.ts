import type { TelegramTranscriptionRuntimeConfig } from "../../daemon/types.js";

export interface OpenAiVoiceTranscriberDependencies {
  fetch?: typeof fetch;
  apiKey?: string;
}

export interface VoiceTranscriptionInput {
  audio: Uint8Array;
  fileName: string;
  mimeType: string;
  config: TelegramTranscriptionRuntimeConfig;
}

export interface VoiceTranscriptionResult {
  text: string;
}

export interface VoiceTranscriber {
  transcribe(input: VoiceTranscriptionInput): Promise<VoiceTranscriptionResult>;
}

export function createOpenAiVoiceTranscriber(
  dependencies: OpenAiVoiceTranscriberDependencies = {},
): VoiceTranscriber {
  const fetchImpl = dependencies.fetch ?? fetch;
  const apiKey = dependencies.apiKey ?? process.env.OPENAI_API_KEY;

  return {
    async transcribe(input: VoiceTranscriptionInput): Promise<VoiceTranscriptionResult> {
      if (!apiKey) {
        throw new Error("Voice transcription requires OPENAI_API_KEY.");
      }

      if (input.config.provider !== "openai") {
        throw new Error(`Unsupported voice transcription provider: ${input.config.provider}`);
      }

      const body = new FormData();
      body.set(
        "file",
        new File([toArrayBuffer(input.audio)], input.fileName, { type: input.mimeType }),
      );
      body.set("model", input.config.model);
      body.set("response_format", "json");
      if (input.config.language) {
        body.set("language", input.config.language);
      }

      const response = await fetchImpl(getOpenAiTranscriptionUrl(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body,
      });

      if (!response.ok) {
        throw new Error(await formatOpenAiTranscriptionFailure(response));
      }

      const payload = await response.json();
      const text = extractTranscriptText(payload);
      if (!text) {
        throw new Error("OpenAI transcription response did not include text.");
      }

      return { text };
    },
  };
}

function getOpenAiTranscriptionUrl(): string {
  return ["https://api.openai.com", "v" + "1", "audio", "transcriptions"].join("/");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function formatOpenAiTranscriptionFailure(response: Response): Promise<string> {
  let details = `${response.status} ${response.statusText}`.trim();

  try {
    const payload = await response.json();
    const message = extractErrorMessage(payload);
    if (message) {
      details = `${details}: ${message}`;
    }
  } catch {
    // Ignore unreadable error bodies and keep the HTTP status text.
  }

  return `OpenAI transcription request failed (${details}).`;
}

function extractTranscriptText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const text = (payload as { text?: unknown }).text;
  if (typeof text !== "string") {
    return undefined;
  }

  const normalized = text.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const error = (payload as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string" && error.message.trim().length > 0
    ? error.message.trim()
    : undefined;
}

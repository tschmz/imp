import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";

export async function synthesizeSpeech(config, text, speech = {}, options = {}) {
  if (!options.fetchImpl) {
    throw new Error("Global fetch is not available.");
  }

  switch (config.provider) {
    case "openai":
      return await synthesizeOpenAi(config, text, speech, options.fetchImpl);
    case "elevenlabs":
      return await synthesizeElevenLabs(config, text, speech, options.fetchImpl);
    default:
      throw new Error(`Unsupported TTS provider: ${config.provider}`);
  }
}

async function synthesizeOpenAi(config, text, speech, fetchImpl) {
  const apiKey = requiredApiKey(config.apiKeyEnv);
  const format = speech.format ?? config.fallbackFormat;
  const instructions = speech.instructions ?? config.fallbackInstructions;
  const audioPath = await createAudioPath("imp-voice-tts-", format);
  const response = await fetchImpl("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: speech.model ?? config.fallbackModel,
      voice: speech.voice ?? config.fallbackVoice,
      input: text,
      response_format: format,
      ...(instructions ? { instructions } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI TTS failed: ${response.status} ${response.statusText} ${await response.text()}`);
  }

  await writeFile(audioPath, Buffer.from(await response.arrayBuffer()));
  return audioPath;
}

async function synthesizeElevenLabs(config, text, speech, fetchImpl) {
  const apiKey = requiredApiKey(config.apiKeyEnv);
  const voiceId = normalizeElevenLabsVoice(speech.voice) ?? config.fallbackVoice;
  if (!voiceId) {
    throw new Error("ElevenLabs TTS requires a configured voice id.");
  }

  const outputFormat = speech.format ?? config.fallbackFormat;
  const audioPath = await createAudioPath("imp-voice-tts-", outputFormat);
  const url = new URL(`/v1/text-to-speech/${encodeURIComponent(voiceId)}`, config.baseUrl);
  url.searchParams.set("output_format", outputFormat);
  const response = await fetchImpl(url.toString(), {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: normalizeElevenLabsModel(speech.model) ?? config.fallbackModel,
    }),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs TTS failed: ${response.status} ${response.statusText} ${await response.text()}`);
  }

  await writeFile(audioPath, Buffer.from(await response.arrayBuffer()));
  return audioPath;
}

function requiredApiKey(apiKeyEnv) {
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(`${apiKeyEnv} is not set.`);
  }
  return apiKey;
}

function normalizeElevenLabsModel(model) {
  if (typeof model !== "string" || model.length === 0) {
    return undefined;
  }
  return isOpenAiTtsModel(model) ? undefined : model;
}

function normalizeElevenLabsVoice(voice) {
  if (typeof voice !== "string" || voice.length === 0) {
    return undefined;
  }
  return isOpenAiTtsVoice(voice) ? undefined : voice;
}

function isOpenAiTtsModel(model) {
  return /^gpt-[\w.-]*tts/i.test(model) || /^tts-[\w.-]+/i.test(model);
}

function isOpenAiTtsVoice(voice) {
  return new Set(["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"]).has(
    voice,
  );
}

async function createAudioPath(prefix, format) {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  return join(tempDir, `reply.${extensionForFormat(format)}`);
}

function extensionForFormat(format) {
  const value = String(format);
  if (value.startsWith("mp3")) {
    return "mp3";
  }
  if (value.startsWith("wav")) {
    return "wav";
  }
  if (value.startsWith("pcm")) {
    return "raw";
  }
  if (value.startsWith("opus")) {
    return "opus";
  }
  if (value.startsWith("ulaw")) {
    return "ulaw";
  }
  if (value.startsWith("alaw")) {
    return "alaw";
  }
  return value;
}

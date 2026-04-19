import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";

export async function loadConfig(path) {
  const absolutePath = resolve(path);
  const raw = await readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw);
  return normalizeConfig(parsed, dirname(absolutePath));
}

export function normalizeConfig(input, configDir = process.cwd()) {
  const runtimeDir = resolveConfigPath(
    process.env.IMP_VOICE_RUNTIME_DIR ?? input.runtimeDir,
    configDir,
  );
  const speaker = input.speaker ?? {};
  const ttsProvider = stringValue(speaker.tts?.provider, "openai");

  return {
    pluginId: stringValue(input.pluginId, "imp-voice"),
    endpointId: stringValue(input.endpointId, "audio-ingress"),
    runtimeDir,
    inboxDir: join(runtimeDir, "inbox"),
    outboxDir: join(runtimeDir, "outbox"),
    conversationId: stringValue(input.conversationId, "imp-voice"),
    userId: stringValue(input.userId, "imp-voice"),
    pollIntervalMs: numberValue(input.pollIntervalMs, 250),
    speaker: {
      failFast: booleanValue(speaker.failFast, false),
      processingDir: resolveMaybeRelative(speaker.processingDir ?? "speaker-processing", runtimeDir),
      processedDir: resolveMaybeRelative(speaker.processedDir ?? "speaker-processed", runtimeDir),
      failedDir: resolveMaybeRelative(speaker.failedDir ?? "speaker-failed", runtimeDir),
      statusFile: resolveMaybeRelative(speaker.statusFile ?? "speaker-status.json", runtimeDir),
      playback: {
        command: stringValue(speaker.playback?.command, "aplay"),
        args: arrayValue(speaker.playback?.args, ["-q"]),
      },
      tts: {
        provider: ttsProvider,
        apiKeyEnv: stringValue(
          speaker.tts?.apiKeyEnv,
          ttsProvider === "elevenlabs" ? "ELEVENLABS_API_KEY" : "OPENAI_API_KEY",
        ),
        baseUrl: stringValue(speaker.tts?.baseUrl, "https://api.elevenlabs.io"),
        fallbackModel: stringValue(
          speaker.tts?.fallbackModel ?? speaker.tts?.model,
          ttsProvider === "elevenlabs" ? "eleven_multilingual_v2" : "gpt-4o-mini-tts",
        ),
        fallbackVoice: stringValue(speaker.tts?.fallbackVoice ?? speaker.tts?.voice, ttsProvider === "elevenlabs" ? "" : "nova"),
        fallbackInstructions: stringValue(speaker.tts?.fallbackInstructions ?? speaker.tts?.instructions, ""),
        fallbackFormat: stringValue(
          speaker.tts?.fallbackFormat ?? speaker.tts?.format,
          ttsProvider === "elevenlabs" ? "wav_16000" : "wav",
        ),
      },
    },
  };
}

function resolveConfigPath(path, configDir) {
  if (!path || typeof path !== "string") {
    throw new Error("Config field runtimeDir must be a non-empty string.");
  }

  return resolveMaybeRelative(path, configDir);
}

function resolveMaybeRelative(path, baseDir) {
  const expanded = path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
}

function stringValue(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberValue(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function arrayValue(value, fallback) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : fallback;
}

function booleanValue(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

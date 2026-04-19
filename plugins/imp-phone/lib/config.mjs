import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";

export async function loadConfig(path) {
  const absolutePath = resolve(path);
  const raw = await readFile(absolutePath, "utf8");
  return normalizeConfig(JSON.parse(raw), dirname(absolutePath));
}

export function normalizeConfig(input, configDir = process.cwd()) {
  const runtimeDir = resolveConfigPath(
    process.env.IMP_PHONE_RUNTIME_DIR ?? input.runtimeDir,
    configDir,
    "runtimeDir",
  );
  const requestsDir = resolveConfigPath(
    process.env.IMP_PHONE_REQUESTS_DIR ?? input.requestsDir ?? "phone-requests",
    process.env.IMP_PHONE_REQUESTS_DIR || input.requestsDir ? configDir : runtimeDir,
    "requestsDir",
  );
  const controlDir = resolveConfigPath(
    process.env.IMP_PHONE_CONTROL_DIR ?? input.controlDir ?? "control",
    process.env.IMP_PHONE_CONTROL_DIR || input.controlDir ? configDir : requestsDir,
    "controlDir",
  );
  const recordingsDir = resolveConfigPath(
    process.env.IMP_PHONE_RECORDINGS_DIR ?? input.recordingsDir ?? "phone-recordings",
    process.env.IMP_PHONE_RECORDINGS_DIR || input.recordingsDir ? configDir : runtimeDir,
    "recordingsDir",
  );
  const call = input.call ?? {};
  const capture = input.capture ?? {};
  const transcription = input.transcription ?? {};
  const tts = input.tts ?? {};
  const playback = input.playback ?? {};
  const conversation = input.conversation ?? {};
  const feedbackTones = input.feedbackTones ?? {};

  return {
    pluginId: stringValue(input.pluginId, "imp-phone"),
    endpointId: stringValue(input.endpointId, "phone-ingress"),
    runtimeDir,
    inboxDir: join(runtimeDir, "inbox"),
    outboxDir: join(runtimeDir, "outbox"),
    requestsDir,
    requestProcessingDir: join(requestsDir, "processing"),
    requestProcessedDir: join(requestsDir, "processed"),
    requestFailedDir: join(requestsDir, "failed"),
    controlDir,
    recordingsDir,
    conversationIdPrefix: stringValue(input.conversationIdPrefix, "imp-phone"),
    userId: stringValue(input.userId, "imp-phone"),
    pollIntervalMs: numberValue(input.pollIntervalMs, 250),
    statusFile: resolveMaybeRelative(input.statusFile ?? "phone-status.json", runtimeDir),
    call: {
      command: stringValue(call.command, "baresip"),
      args: arrayValue(call.args, []),
      dialCommand: stringValue(call.dialCommand, "/dial {uri}"),
      registerTimeoutMs: numberValue(call.registerTimeoutMs, 10000),
      answerTimeoutMs: numberValue(call.answerTimeoutMs ?? call.answerDelayMs, 60000),
      maxTurns: integerValue(call.maxTurns, 8),
    },
    capture: {
      command: stringValue(capture.command, "arecord"),
      args: arrayValue(capture.args, ["-q", "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw"]),
      sampleRate: integerValue(capture.sampleRate, 16000),
      channels: integerValue(capture.channels, 1),
      chunkMs: integerValue(capture.chunkMs, 80),
      startThresholdRms: integerValue(capture.startThresholdRms, 900),
      stopThresholdRms: integerValue(capture.stopThresholdRms, 900),
      silenceMs: integerValue(capture.silenceMs, 1200),
      preRollMs: integerValue(capture.preRollMs, 600),
      minSeconds: numberValue(capture.minSeconds, 1.0),
      maxSeconds: numberValue(capture.maxSeconds, 20.0),
      noSpeechTimeoutSeconds: numberValue(capture.noSpeechTimeoutSeconds, 30.0),
    },
    transcription: {
      provider: stringValue(transcription.provider, "openai"),
      apiKeyEnv: stringValue(transcription.apiKeyEnv, "OPENAI_API_KEY"),
      model: stringValue(transcription.model, "gpt-4o-mini-transcribe"),
      prompt: stringValue(transcription.prompt, ""),
    },
    tts: {
      provider: stringValue(tts.provider, "openai"),
      apiKeyEnv: stringValue(tts.apiKeyEnv, "OPENAI_API_KEY"),
      fallbackModel: stringValue(tts.fallbackModel ?? tts.model, "gpt-4o-mini-tts"),
      fallbackVoice: stringValue(tts.fallbackVoice ?? tts.voice, "nova"),
      fallbackInstructions: stringValue(tts.fallbackInstructions ?? tts.instructions, ""),
      fallbackFormat: stringValue(tts.fallbackFormat ?? tts.format, "wav"),
    },
    playback: {
      command: stringValue(playback.command, "aplay"),
      args: arrayValue(playback.args, ["-q", "{path}"]),
    },
    conversation: {
      closePhrases: arrayValue(conversation.closePhrases, []),
      responseTimeoutSeconds: numberValue(conversation.responseTimeoutSeconds, 600.0),
      holdMessageAfterSeconds: numberValue(conversation.holdMessageAfterSeconds, 8.0),
      holdMessageIntervalSeconds: numberValue(conversation.holdMessageIntervalSeconds, 20.0),
      holdMessageText: stringValue(conversation.holdMessageText, "Einen Moment bitte."),
    },
    feedbackTones: {
      enabled: booleanValue(feedbackTones.enabled, true),
      sampleRate: integerValue(feedbackTones.sampleRate, 16000),
      quietAfterMs: integerValue(feedbackTones.quietAfterMs, 120),
    },
  };
}

function resolveConfigPath(path, baseDir, fieldName) {
  if (!path || typeof path !== "string") {
    throw new Error(`Config field ${fieldName} must be a non-empty string.`);
  }

  return resolveMaybeRelative(path, baseDir);
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

function integerValue(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function booleanValue(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function arrayValue(value, fallback) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : fallback;
}

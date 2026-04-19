import { randomUUID } from "node:crypto";
import { Blob } from "node:buffer";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { ensureDirs, sanitizeFileName, writeJsonAtomic } from "./files.mjs";
import { buildFeedbackTone, recordSpeechTurn, renderArgs, renderTemplate, runCommand, writeWav } from "./audio.mjs";

export class PhoneController {
  constructor(config, options = {}) {
    this.config = config;
    this.once = options.once ?? false;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.log = options.log ?? ((message) => console.log(message));
    this.stopped = false;
    this.lastCall = undefined;
  }

  async run() {
    await this.ensureDirs();
    await this.writeStatus("active");

    while (!this.stopped) {
      const requestPath = await this.nextRequestFile();
      if (!requestPath) {
        if (this.once) {
          this.log("No phone request file found.");
          return 0;
        }
        await sleep(this.config.pollIntervalMs);
        continue;
      }

      await this.processRequestFile(requestPath);
      if (this.once) {
        return 0;
      }
    }
    return 0;
  }

  stop() {
    this.stopped = true;
  }

  async ensureDirs() {
    await ensureDirs([
      this.config.inboxDir,
      this.config.outboxDir,
      this.config.requestsDir,
      this.config.requestProcessingDir,
      this.config.requestProcessedDir,
      this.config.requestFailedDir,
      this.config.recordingsDir,
    ]);
  }

  async nextRequestFile() {
    const entries = await readdir(this.config.requestsDir, { withFileTypes: true }).catch(() => []);
    const candidate = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort()[0];
    return candidate ? join(this.config.requestsDir, candidate) : undefined;
  }

  async processRequestFile(path) {
    const processingPath = join(
      this.config.requestProcessingDir,
      `${Date.now()}-${randomUUID()}-${sanitizeFileName(basename(path))}`,
    );

    try {
      await rename(path, processingPath);
    } catch {
      return;
    }

    try {
      const request = JSON.parse(await readFile(processingPath, "utf8"));
      await this.processRequest(request);
      await rename(processingPath, join(this.config.requestProcessedDir, basename(processingPath)));
    } catch (error) {
      const failedPath = join(this.config.requestFailedDir, basename(processingPath));
      await rename(processingPath, failedPath).catch(() => undefined);
      await writeJsonAtomic(`${failedPath}.error.json`, {
        failedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      await this.writeStatus("failed", {
        requestFile: basename(path),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async processRequest(request) {
    const contact = parseContact(request);
    const requestedAgentId = parseRequestedAgentId(request);
    const requestId = typeof request.id === "string" && request.id.length > 0 ? request.id : randomUUID();
    const conversationId = `${this.config.conversationIdPrefix}-${sanitizeFileName(requestId)}`;
    const callProcess = this.startCall(contact);
    this.lastCall = {
      requestId,
      conversationId,
      contactId: contact.id,
      contactName: contact.name,
      state: "calling",
      phase: "calling",
      updatedAt: new Date().toISOString(),
    };

    await this.writeRuntimeStatus("calling", false, {
      requestId,
      conversationId,
      contactId: contact.id,
      contactName: contact.name,
    });

    try {
      const dialFailure = await callProcess.waitUntilRegisteredAndDial(this.config.call.registerTimeoutMs);
      if (dialFailure) {
        await this.closeCall("call-failed", { error: dialFailure });
        return;
      }

      await this.writeRuntimeStatus("calling", false);
      const answerResult = await callProcess.waitForAnswer(this.config.call.answerTimeoutMs, async (event) => {
        if (event === "ringing") {
          await this.writeRuntimeStatus("ringing", false);
        }
      });
      if (answerResult.status === "failed") {
        await this.closeCall("call-failed", { error: answerResult.reason });
        return;
      }
      if (answerResult.status === "timeout") {
        await this.closeCall("answer-timeout");
        return;
      }

      await this.writeRuntimeStatus("answered", false);

      for (let turn = 1; turn <= this.config.call.maxTurns && !this.stopped; turn += 1) {
        const turnFailure = await callProcess.waitForFailure(0);
        if (turnFailure) {
          await this.closeCall("call-failed", { error: turnFailure });
          break;
        }

        const recordingPath = join(
          this.config.recordingsDir,
          `${sanitizeFileName(requestId)}-turn-${String(turn).padStart(2, "0")}.wav`,
        );

        await this.writeRuntimeStatus("recording_command", true, {
          requestId,
          conversationId,
          contactId: contact.id,
          turn,
        });
        const recording = await recordSpeechTurn(this.config, recordingPath);
        await this.playFeedbackTone("captured", contact).catch((error) => {
          this.log(`Feedback tone 'captured' could not be played: ${error instanceof Error ? error.message : String(error)}`);
        });
        if (recording.empty) {
          await this.closeCall(recording.reason);
          break;
        }

        await this.writeRuntimeStatus("transcribing_command", false, {
          requestId,
          conversationId,
          turn,
          recordingFile: recording.path,
        });
        const transcript = (await this.transcribe(recording.path)).trim();
        if (!transcript) {
          await this.playFeedbackTone("error", contact).catch((error) => {
            this.log(`Feedback tone 'error' could not be played: ${error instanceof Error ? error.message : String(error)}`);
          });
          await this.closeCall("empty-transcript");
          break;
        }
        if (this.isClosePhrase(transcript)) {
          await this.playFeedbackTone("closed", contact).catch((error) => {
            this.log(`Feedback tone 'closed' could not be played: ${error instanceof Error ? error.message : String(error)}`);
          });
          await this.closeCall("close-phrase", { transcript });
          break;
        }

        const event = await this.writeIngressEvent({
          requestId,
          conversationId,
          requestedAgentId,
          contact,
          turn,
          transcript,
          recording,
        });

        await this.playFeedbackTone("accepted", contact).catch((error) => {
          this.log(`Feedback tone 'accepted' could not be played: ${error instanceof Error ? error.message : String(error)}`);
        });
        await this.writeRuntimeStatus("waiting_for_speaker", false, {
          requestId,
          conversationId,
          turn,
          transcript,
        });
        const reply = await this.waitForOutboxReply(event, contact);
        if (!reply.text.trim()) {
          continue;
        }

        await this.writeRuntimeStatus("speaking", false, {
          requestId,
          conversationId,
          turn,
          text: reply.text,
        });
        const audioPath = await this.synthesize(reply.text, reply.speech);
        try {
          await this.play(audioPath, contact);
        } finally {
          await rm(dirname(audioPath), { recursive: true, force: true });
        }
      }
      if (!this.stopped && this.lastCall?.phase !== "conversation_closed") {
        await this.closeCall("max-turns");
      }
    } finally {
      callProcess.kill();
      await this.writeStatus("active");
    }
  }

  startCall(contact) {
    const fields = {
      uri: contact.uri,
      contactId: contact.id,
      contactName: contact.name,
    };
    const command = renderTemplate(this.config.call.command, fields);
    const args = renderArgs(this.config.call.args, fields);
    const dialCommand = renderTemplate(this.config.call.dialCommand, fields);
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const monitor = createCallMonitor(child);
    child.stdout?.on("data", (chunk) => this.logCallOutput(chunk));
    child.stderr?.on("data", (chunk) => this.logCallOutput(chunk));
    child.on("error", (error) => {
      this.log(`Call process failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return {
      kill: () => child.kill(),
      waitUntilRegisteredAndDial: (timeoutMs) => monitor.waitUntilRegisteredAndDial(dialCommand, timeoutMs),
      waitForAnswer: (timeoutMs, onProgress) => monitor.waitForAnswer(timeoutMs, onProgress),
      waitForFailure: (timeoutMs) => monitor.waitForFailure(timeoutMs),
    };
  }

  logCallOutput(chunk) {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) {
        this.log(line);
      }
    }
  }

  async writeIngressEvent(input) {
    const eventId = `${sanitizeFileName(input.requestId)}-turn-${String(input.turn).padStart(2, "0")}`;
    const correlationId = randomUUID();
    const eventPath = join(this.config.inboxDir, `${eventId}-${process.hrtime.bigint().toString()}.json`);
    const payload = {
      schemaVersion: 1,
      id: eventId,
      correlationId,
      conversationId: input.conversationId,
      session: {
        mode: "detached",
        id: input.conversationId,
        ...(input.requestedAgentId ? { agentId: input.requestedAgentId } : {}),
        kind: "phone-call",
        title: `Phone call: ${input.contact.name}`,
        metadata: {
          source: "imp-phone",
          ...(input.requestedAgentId ? { agent_id: input.requestedAgentId } : {}),
          request_id: input.requestId,
          contact_id: input.contact.id,
          contact_name: input.contact.name,
          contact_uri: input.contact.uri,
        },
      },
      userId: this.config.userId,
      text: input.transcript,
      receivedAt: new Date().toISOString(),
      metadata: {
        source: "imp-phone",
        ...(input.requestedAgentId ? { agent_id: input.requestedAgentId } : {}),
        request_id: input.requestId,
        contact_id: input.contact.id,
        contact_name: input.contact.name,
        contact_uri: input.contact.uri,
        turn: input.turn,
        recording_file: input.recording.path,
        duration_seconds: input.recording.durationSeconds,
        finish_reason: input.recording.reason,
        max_rms: input.recording.maxRms,
      },
    };
    await writeJsonAtomic(eventPath, payload);
    return {
      eventId,
      correlationId,
      conversationId: input.conversationId,
    };
  }

  async waitForOutboxReply(event, contact) {
    const deadline = Date.now() + this.config.conversation.responseTimeoutSeconds * 1000;
    let nextHoldAt = Date.now() + this.config.conversation.holdMessageAfterSeconds * 1000;
    while (Date.now() < deadline && !this.stopped) {
      const filePath = await this.nextOutboxFile();
      if (!filePath) {
        if (Date.now() >= nextHoldAt) {
          await this.playHoldMessage(contact).catch((error) => {
            this.log(`Hold message could not be played: ${error instanceof Error ? error.message : String(error)}`);
          });
          nextHoldAt = Date.now() + this.config.conversation.holdMessageIntervalSeconds * 1000;
        }
        await sleep(this.config.pollIntervalMs);
        continue;
      }

      const payload = JSON.parse(await readFile(filePath, "utf8"));
      if (payload.eventId !== event.eventId && payload.correlationId !== event.correlationId) {
        await sleep(this.config.pollIntervalMs);
        continue;
      }

      const processingPath = join(dirname(filePath), `${basename(filePath)}.processing`);
      await rename(filePath, processingPath);
      const reply = {
        text: String(payload.text ?? ""),
        speech: typeof payload.speech === "object" && payload.speech !== null ? payload.speech : {},
      };
      await rm(processingPath, { force: true });
      return reply;
    }

    throw new Error(`Timed out waiting for agent reply to phone event ${event.eventId}.`);
  }

  async nextOutboxFile() {
    const entries = await readdir(this.config.outboxDir, { withFileTypes: true }).catch(() => []);
    const candidate = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort()[0];
    return candidate ? join(this.config.outboxDir, candidate) : undefined;
  }

  async transcribe(audioPath) {
    assertOpenAi("transcription", this.config.transcription.provider, this.config.transcription.apiKeyEnv);
    const apiKey = process.env[this.config.transcription.apiKeyEnv];
    const audio = await readFile(audioPath);
    const form = new globalThis.FormData();
    form.append("model", this.config.transcription.model);
    form.append("response_format", "text");
    if (this.config.transcription.prompt) {
      form.append("prompt", this.config.transcription.prompt);
    }
    form.append("file", new Blob([audio], { type: "audio/wav" }), basename(audioPath));

    const response = await this.fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });
    if (!response.ok) {
      throw new Error(`OpenAI transcription failed: ${response.status} ${response.statusText} ${await response.text()}`);
    }
    return await response.text();
  }

  async synthesize(text, speech = {}) {
    assertOpenAi("TTS", this.config.tts.provider, this.config.tts.apiKeyEnv);
    const apiKey = process.env[this.config.tts.apiKeyEnv];
    const tempDir = await mkdtemp(join(tmpdir(), "imp-phone-tts-"));
    const format = speech.format ?? this.config.tts.fallbackFormat;
    const instructions = speech.instructions ?? this.config.tts.fallbackInstructions;
    const audioPath = join(tempDir, `reply.${format}`);
    const response = await this.fetchImpl("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: speech.model ?? this.config.tts.fallbackModel,
        voice: speech.voice ?? this.config.tts.fallbackVoice,
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

  async play(audioPath, contact) {
    const fields = {
      path: audioPath,
      uri: contact.uri,
      contactId: contact.id,
      contactName: contact.name,
    };
    await runCommand(
      renderTemplate(this.config.playback.command, fields),
      renderArgs(this.config.playback.args, fields),
    );
  }

  async playHoldMessage(contact) {
    const text = this.config.conversation.holdMessageText.trim();
    if (!text) {
      return;
    }
    const audioPath = await this.synthesize(text);
    try {
      await this.play(audioPath, contact);
    } finally {
      await rm(dirname(audioPath), { recursive: true, force: true });
    }
  }

  async playFeedbackTone(name, contact) {
    if (!this.config.feedbackTones.enabled) {
      return;
    }
    const tempDir = await mkdtemp(join(tmpdir(), "imp-phone-tone-"));
    const tonePath = join(tempDir, `${name}.wav`);
    const tone = buildFeedbackTone(name, {
      sampleRate: this.config.feedbackTones.sampleRate,
    });
    await writeWav(tonePath, tone.pcm, {
      sampleRate: this.config.feedbackTones.sampleRate,
      channels: 1,
    });
    try {
      await this.play(tonePath, contact);
      if (this.config.feedbackTones.quietAfterMs > 0) {
        await sleep(this.config.feedbackTones.quietAfterMs);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  isClosePhrase(text) {
    const normalized = normalizeText(text);
    return this.config.conversation.closePhrases.some((phrase) => normalizeText(phrase) === normalized);
  }

  async closeCall(reason, fields = {}) {
    await this.writeRuntimeStatus("conversation_closed", false, {
      closed_reason: reason,
      reason,
      ...fields,
    });
  }

  async writeRuntimeStatus(phase, canSpeak, fields = {}) {
    const state = stateForPhase(phase);
    this.lastCall = {
      ...(this.lastCall ?? {}),
      state,
      phase,
      can_speak: canSpeak,
      updatedAt: new Date().toISOString(),
      ...pickLastCallFields(fields),
    };
    await this.writeStatus("active", {
      state,
      phase,
      can_speak: canSpeak,
      ...fields,
    });
  }

  async writeStatus(status, fields = {}) {
    await writeJsonAtomic(this.config.statusFile, {
      schemaVersion: 1,
      service: "imp-phone-controller",
      status,
      updatedAt: new Date().toISOString(),
      ...(this.lastCall ? { lastCall: this.lastCall } : {}),
      ...fields,
    });
  }
}

export function parseContact(request) {
  if (typeof request !== "object" || request === null) {
    throw new Error("Call request must be an object.");
  }
  const contact = request.contact;
  if (typeof contact !== "object" || contact === null) {
    throw new Error("Call request must contain a contact object.");
  }
  for (const field of ["id", "name", "uri"]) {
    if (typeof contact[field] !== "string" || contact[field].length === 0) {
      throw new Error(`Call request contact.${field} must be a non-empty string.`);
    }
  }
  return {
    id: contact.id,
    name: contact.name,
    uri: contact.uri,
  };
}

export function parseRequestedAgentId(request) {
  if (typeof request !== "object" || request === null || !("agentId" in request)) {
    return undefined;
  }
  if (request.agentId === undefined || request.agentId === null || request.agentId === "") {
    return undefined;
  }
  if (typeof request.agentId !== "string") {
    throw new Error("Call request agentId must be a string when provided.");
  }
  return request.agentId;
}

export function parseCallFailureReason(text) {
  const sessionClosed = String(text).match(/session closed:\s*([4-6]\d\d[^\r\n]*)/i);
  if (sessionClosed) {
    return sessionClosed[1].trim();
  }
  const rejected = String(text).match(/\bSIP Progress:\s*([4-6]\d\d[^\r\n]*)/i);
  return rejected ? rejected[1].trim() : undefined;
}

export function parseCallProgress(text) {
  const value = String(text);
  if (/\bSIP Progress:\s*18[03]\b/i.test(value)) {
    return "ringing";
  }
  if (/\bSIP Progress:\s*200\b/i.test(value) || /\bcall established\b/i.test(value) || /\baudio established\b/i.test(value)) {
    return "answered";
  }
  if (/session closed:/i.test(value)) {
    return "closed";
  }
  return undefined;
}

export function isCallReadyOutput(text) {
  return (
    /All\s+\d+\s+useragent\s+registered\s+successfully!/i.test(String(text)) ||
    /\b\d+\s+OK\s+\(\)\s+\[\d+\s+binding\]/i.test(String(text))
  );
}

function stateForPhase(phase) {
  switch (phase) {
    case "calling":
      return "calling";
    case "ringing":
      return "ringing";
    case "answered":
    case "recording_command":
    case "transcribing_command":
    case "waiting_for_speaker":
    case "speaking":
      return "in_call";
    case "conversation_closed":
      return "closed";
    default:
      return phase;
  }
}

function pickLastCallFields(fields) {
  const allowed = [
    "requestId",
    "conversationId",
    "contactId",
    "contactName",
    "turn",
    "transcript",
    "recordingFile",
    "reason",
    "closed_reason",
    "error",
    "text",
  ];
  return Object.fromEntries(allowed.filter((key) => fields[key] !== undefined).map((key) => [key, fields[key]]));
}

function assertOpenAi(kind, provider, apiKeyEnv) {
  if (provider !== "openai") {
    throw new Error(`Unsupported ${kind} provider: ${provider}`);
  }
  if (!globalThis.fetch) {
    throw new Error("Global fetch is not available.");
  }
  if (!process.env[apiKeyEnv]) {
    throw new Error(`${apiKeyEnv} is not set.`);
  }
}

function normalizeText(text) {
  return String(text).trim().toLowerCase().replace(/[.!?]+$/g, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createCallMonitor(child) {
  let failure;
  let registered = false;
  let answered = false;
  let dialed = false;
  let resolveFailure;
  let resolveRegistered;
  let resolveAnswered;
  const progressListeners = new Set();
  const failurePromise = new Promise((resolve) => {
    resolveFailure = resolve;
  });
  const registeredPromise = new Promise((resolve) => {
    resolveRegistered = resolve;
  });
  const answeredPromise = new Promise((resolve) => {
    resolveAnswered = resolve;
  });

  const markFailure = (reason) => {
    if (!failure) {
      failure = reason;
      resolveFailure(reason);
    }
  };

  const watchOutput = (chunk) => {
    if (isCallReadyOutput(chunk)) {
      registered = true;
      resolveRegistered();
    }
    const progress = parseCallProgress(chunk);
    if (progress) {
      for (const listener of progressListeners) {
        listener(progress);
      }
      if (progress === "answered") {
        answered = true;
        resolveAnswered();
      }
      if (progress === "closed") {
        markFailure(answered ? "call closed" : "call closed before answer");
      }
    }
    const reason = parseCallFailureReason(chunk);
    if (reason) {
      markFailure(reason);
    }
  };

  child.stdout?.on("data", watchOutput);
  child.stderr?.on("data", watchOutput);
  child.on("error", (error) => {
    markFailure(error instanceof Error ? error.message : String(error));
  });
  child.on("exit", (code, signal) => {
    if (code && code !== 0) {
      markFailure(`call process exited with code ${code}`);
      return;
    }
    if (signal && signal !== "SIGTERM") {
      markFailure(`call process exited with signal ${signal}`);
    }
  });

  return {
    async waitUntilRegisteredAndDial(dialCommand, timeoutMs) {
      if (failure) {
        return failure;
      }
      if (!registered) {
        const result = await Promise.race([
          registeredPromise.then(() => "registered"),
          failurePromise.then((reason) => reason),
          sleep(timeoutMs).then(() => "timeout"),
        ]);
        if (result === "timeout") {
          markFailure("baresip registration timed out");
          return failure;
        }
        if (result !== "registered") {
          return result;
        }
      }
      if (!dialed) {
        dialed = true;
        child.stdin?.write(`${dialCommand}\n`);
      }
      return undefined;
    },

    async waitForAnswer(timeoutMs, onProgress = () => undefined) {
      if (failure) {
        return { status: "failed", reason: failure };
      }
      if (answered) {
        return { status: "answered" };
      }
      progressListeners.add(onProgress);
      try {
        const result = await Promise.race([
          answeredPromise.then(() => ({ status: "answered" })),
          failurePromise.then((reason) => ({ status: "failed", reason })),
          sleep(timeoutMs).then(() => ({ status: "timeout" })),
        ]);
        return result;
      } finally {
        progressListeners.delete(onProgress);
      }
    },

    async waitForFailure(timeoutMs) {
      if (failure || timeoutMs <= 0) {
        return failure;
      }
      return await Promise.race([failurePromise, sleep(timeoutMs).then(() => undefined)]);
    },
  };
}

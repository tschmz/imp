import { mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { ensureDirs, readJson, writeJsonAtomic, buildClaimedFileName } from "./files.mjs";

export class SpeakerOutboxConsumer {
  constructor(config, options = {}) {
    this.config = config;
    this.failFast = config.speaker.failFast ?? false;
    this.lastError = undefined;
    this.once = options.once ?? false;
    this.playAudio = options.playAudio ?? true;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.log = options.log ?? ((message) => console.log(message));
  }

  async ensureDirs() {
    await ensureDirs([
      this.config.outboxDir,
      this.config.speaker.processingDir,
      this.config.speaker.processedDir,
      this.config.speaker.failedDir,
    ]);
  }

  async run() {
    await this.ensureDirs();
    await this.writeStatus("active");
    let processedAny = false;

    while (true) {
      const filePath = await this.nextOutboxFile();
      if (!filePath) {
        if (this.once) {
          if (!processedAny) {
            this.log("No outbox file found.");
          }
          return 0;
        }
        await sleep(this.config.pollIntervalMs);
        continue;
      }

      processedAny = true;
      const ok = await this.processFile(filePath);
      if (!ok) {
        if (this.failFast) {
          return 1;
        }
        await this.writeStatus("active");
        continue;
      }
      if (this.once) {
        return 0;
      }
    }
  }

  async nextOutboxFile() {
    const entries = await readdir(this.config.outboxDir, { withFileTypes: true }).catch(() => []);
    const candidate = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort()[0];
    return candidate ? join(this.config.outboxDir, candidate) : undefined;
  }

  async processFile(filePath) {
    const fileName = filePath.split("/").at(-1) ?? "reply.json";
    const claimedPath = join(this.config.speaker.processingDir, buildClaimedFileName(fileName));

    try {
      await rename(filePath, claimedPath);
    } catch {
      return true;
    }

    try {
      const payload = await readJson(claimedPath);
      await this.processPayload(payload);
      await rename(claimedPath, join(this.config.speaker.processedDir, claimedPath.split("/").at(-1)));
      await this.writeStatus("processed", {
        file: claimedPath.split("/").at(-1),
        text: String(payload.text ?? ""),
      });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedName = claimedPath.split("/").at(-1);
      const failedPath = join(this.config.speaker.failedDir, failedName);
      await rename(claimedPath, failedPath).catch(() => undefined);
      await writeJsonAtomic(`${failedPath}.error.json`, {
        failedAt: new Date().toISOString(),
        error: errorMessage,
      });
      this.lastError = {
        file: failedName,
        message: errorMessage,
        failedAt: new Date().toISOString(),
      };
      await this.writeStatus("failed", {
        file: failedName,
        error: errorMessage,
      });
      return false;
    }
  }

  async processPayload(payload) {
    const text = String(payload.text ?? "").trim();
    if (!text) {
      throw new Error("Outbox payload does not contain text.");
    }
    if (isExpired(payload)) {
      this.log(`Skipping expired reply: ${text}`);
      return;
    }
    if (payload.speech && payload.speech.enabled === false) {
      this.log(`Skipping silent reply: ${text}`);
      return;
    }

    const speech = typeof payload.speech === "object" && payload.speech !== null ? payload.speech : {};
    this.log(`Speaking reply: ${text}`);
    const audioPath = await this.synthesize(text, speech);
    try {
      if (this.playAudio) {
        await this.writeStatus("speaking", { text });
        try {
          await this.play(audioPath);
        } finally {
          await this.writeStatus("active");
        }
      }
    } finally {
      await rm(dirname(audioPath), { recursive: true, force: true });
    }
  }

  async synthesize(text, speech = {}) {
    if (this.config.speaker.tts.provider !== "openai") {
      throw new Error(`Unsupported TTS provider: ${this.config.speaker.tts.provider}`);
    }

    if (!this.fetchImpl) {
      throw new Error("Global fetch is not available.");
    }

    const apiKey = process.env[this.config.speaker.tts.apiKeyEnv];
    if (!apiKey) {
      throw new Error(`${this.config.speaker.tts.apiKeyEnv} is not set.`);
    }

    const tempDir = await mkdtemp(join(tmpdir(), "imp-voice-tts-"));
    const format = speech.format ?? this.config.speaker.tts.fallbackFormat;
    const instructions = speech.instructions ?? this.config.speaker.tts.fallbackInstructions;
    const audioPath = join(tempDir, `reply.${format}`);
    const response = await this.fetchImpl("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: speech.model ?? this.config.speaker.tts.fallbackModel,
        voice: speech.voice ?? this.config.speaker.tts.fallbackVoice,
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

  async play(audioPath) {
    const command = this.config.speaker.playback.command;
    const args = [...this.config.speaker.playback.args, audioPath];
    await runCommand(command, args);
  }

  async writeStatus(status, fields = {}) {
    await writeJsonAtomic(this.config.speaker.statusFile, {
      schemaVersion: 1,
      service: "imp-voice-out",
      status,
      updatedAt: new Date().toISOString(),
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ...fields,
    });
  }
}

export function isExpired(payload) {
  if (typeof payload.ttlMs !== "number" || payload.ttlMs <= 0 || typeof payload.createdAt !== "string") {
    return false;
  }

  const createdAt = Date.parse(payload.createdAt);
  if (!Number.isFinite(createdAt)) {
    return false;
  }
  return Date.now() - createdAt > payload.ttlMs;
}

export async function runCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

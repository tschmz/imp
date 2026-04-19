import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { clearTimeout } from "node:timers";

export function renderTemplate(template, fields) {
  return String(template)
    .replaceAll("{uri}", fields.uri ?? "")
    .replaceAll("{contactId}", fields.contactId ?? "")
    .replaceAll("{contactName}", fields.contactName ?? "")
    .replaceAll("{path}", fields.path ?? "");
}

export function renderArgs(args, fields) {
  return args.map((arg) => renderTemplate(arg, fields));
}

export function calculateRms(buffer) {
  const sampleCount = Math.floor(buffer.length / 2);
  if (sampleCount === 0) {
    return 0;
  }

  let sum = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = buffer.readInt16LE(index * 2);
    sum += sample * sample;
  }
  return Math.sqrt(sum / sampleCount);
}

export async function writeWav(path, pcm, options) {
  await mkdir(dirname(path), { recursive: true });
  const dataSize = pcm.length;
  const sampleRate = options.sampleRate;
  const channels = options.channels;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  await writeFile(path, Buffer.concat([header, pcm]));
}

export function buildFeedbackTone(name, options = {}) {
  const sampleRate = options.sampleRate ?? 16000;
  const spacingSeconds = 0.015;
  const toneMap = {
    captured: [
      [1174.0, 0.035, 0.22],
      [784.0, 0.07, 0.24],
    ],
    accepted: [
      [660.0, 0.035, 0.2],
      [880.0, 0.04, 0.22],
      [1174.0, 0.055, 0.24],
    ],
    error: [
      [392.0, 0.07, 0.24],
      [330.0, 0.11, 0.22],
    ],
    closed: [
      [880.0, 0.04, 0.2],
      [659.0, 0.06, 0.22],
      [440.0, 0.11, 0.24],
    ],
  };
  const segments = toneMap[name];
  if (!segments) {
    throw new Error(`Unknown feedback tone: ${name}`);
  }

  const buffers = [];
  let totalDuration = 0;
  const fadeSeconds = 0.005;
  for (const [index, [frequency, duration, amplitude]] of segments.entries()) {
    const frameCount = Math.max(1, Math.floor(sampleRate * duration));
    const fadeFrames = Math.min(Math.floor(frameCount / 2), Math.max(1, Math.floor(sampleRate * fadeSeconds)));
    const buffer = Buffer.alloc(frameCount * 2);
    for (let frame = 0; frame < frameCount; frame += 1) {
      let envelope = 1.0;
      if (frame < fadeFrames) {
        envelope = frame / fadeFrames;
      } else if (frame >= frameCount - fadeFrames) {
        envelope = (frameCount - frame - 1) / fadeFrames;
      }
      const sample = Math.trunc(32767 * amplitude * envelope * Math.sin((2 * Math.PI * frequency * frame) / sampleRate));
      buffer.writeInt16LE(sample, frame * 2);
    }
    buffers.push(buffer);
    totalDuration += duration;
    if (index < segments.length - 1) {
      const silence = Buffer.alloc(Math.max(1, Math.floor(sampleRate * spacingSeconds)) * 2);
      buffers.push(silence);
      totalDuration += spacingSeconds;
    }
  }

  return {
    pcm: Buffer.concat(buffers),
    durationSeconds: totalDuration,
  };
}

export async function runCommand(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? ["ignore", "inherit", "inherit"],
      cwd: options.cwd,
      env: options.env,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}

export async function recordSpeechTurn(config, outputPath) {
  const capture = config.capture;
  const chunkBytes = Math.max(1, Math.floor(capture.sampleRate * capture.channels * 2 * (capture.chunkMs / 1000)));
  const silenceChunks = Math.max(1, Math.ceil(capture.silenceMs / capture.chunkMs));
  const preRollChunks = Math.max(0, Math.ceil(capture.preRollMs / capture.chunkMs));
  const minChunks = Math.max(1, Math.ceil((capture.minSeconds * 1000) / capture.chunkMs));
  const maxChunks = Math.max(1, Math.ceil((capture.maxSeconds * 1000) / capture.chunkMs));
  const noSpeechTimeoutMs = capture.noSpeechTimeoutSeconds * 1000;
  const child = spawn(capture.command, capture.args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const chunks = [];
  const preRoll = [];
  let pending = Buffer.alloc(0);
  let recording = false;
  let silenceStreak = 0;
  let chunkCount = 0;
  let maxRms = 0;
  let resolved = false;
  let noSpeechTimer;

  return await new Promise((resolve, reject) => {
    const cleanup = () => {
      child.stdout.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
      if (noSpeechTimer) {
        clearTimeout(noSpeechTimer);
      }
      child.kill("SIGTERM");
    };

    const finish = async (reason) => {
      if (resolved) {
        return;
      }
      resolved = true;
      cleanup();
      const pcm = Buffer.concat(chunks);
      try {
        await writeWav(outputPath, pcm, {
          sampleRate: capture.sampleRate,
          channels: capture.channels,
        });
        resolve({
          path: outputPath,
          reason,
          durationSeconds: chunkCount * capture.chunkMs / 1000,
          maxRms,
        });
      } catch (error) {
        reject(error);
      }
    };

    noSpeechTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({
          path: outputPath,
          reason: "no-speech-timeout",
          durationSeconds: 0,
          maxRms,
          empty: true,
        });
      }
    }, noSpeechTimeoutMs);
    noSpeechTimer.unref();

    const onError = (error) => {
      if (resolved) {
        return;
      }
      resolved = true;
      cleanup();
      reject(error);
    };

    const onExit = (code, signal) => {
      if (resolved) {
        return;
      }
      resolved = true;
      cleanup();
      reject(new Error(`${capture.command} exited before a speech turn completed (${signal ?? code}). ${stderr}`));
    };

    const onData = (data) => {
      pending = Buffer.concat([pending, data]);
      while (pending.length >= chunkBytes) {
        const chunk = pending.subarray(0, chunkBytes);
        pending = pending.subarray(chunkBytes);
        const rms = calculateRms(chunk);
        maxRms = Math.max(maxRms, rms);

        if (!recording) {
          preRoll.push(Buffer.from(chunk));
          while (preRoll.length > preRollChunks) {
            preRoll.shift();
          }
          if (rms >= capture.startThresholdRms) {
            recording = true;
            chunks.push(...preRoll);
            chunkCount = chunks.length;
            clearTimeout(noSpeechTimer);
          } else {
            continue;
          }
        } else {
          chunks.push(Buffer.from(chunk));
          chunkCount += 1;
        }

        if (rms >= capture.stopThresholdRms) {
          silenceStreak = 0;
        } else {
          silenceStreak += 1;
        }

        if (chunkCount >= maxChunks) {
          finish("max-duration");
          return;
        }
        if (chunkCount >= minChunks && silenceStreak >= silenceChunks) {
          finish("silence");
          return;
        }
      }
    };

    child.on("error", onError);
    child.on("exit", onExit);
    child.stdout.on("data", onData);
  });
}

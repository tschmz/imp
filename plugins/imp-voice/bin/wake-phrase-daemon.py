#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import json
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import tomllib
import unicodedata
import wave
from array import array
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

import numpy as np
import openwakeword
from openwakeword.model import Model as OpenWakeWordModel
from vosk import KaldiRecognizer, Model, SetLogLevel
from imp_plugin_files import HealthWriter, PluginInboxWriter

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "wake-phrase.toml"


@dataclass(slots=True)
class AudioConfig:
    device: str = "default"
    sample_rate: int = 16000
    channels: int = 1
    chunk_ms: int = 80


@dataclass(slots=True)
class WakeCaptureConfig:
    start_chunks: int = 2
    pre_roll_ms: int = 250
    cooldown_seconds: float = 1.5


@dataclass(slots=True)
class WakePhraseConfig:
    display_name: str = "hey jarvis"
    model_name: str = "hey_jarvis"
    threshold: float = 0.9
    log_threshold: float = 0.05
    command_timeout_seconds: float = 8.0
    command_start_delay_ms: int = 500
    no_command_cooldown_seconds: float = 15.0


@dataclass(slots=True)
class CommandRecordingConfig:
    start_threshold_rms: int = 900
    start_chunks: int = 1
    stop_threshold_rms: int = 900
    silence_ms: int = 1200
    pre_roll_ms: int = 600
    min_seconds: float = 1.0
    max_seconds: float = 20.0
    output_dir: Path = Path(__file__).resolve().parent / "recordings"
    write_metadata: bool = True


@dataclass(slots=True)
class CommandTranscriptionConfig:
    enabled: bool = True
    provider: str = "openai"
    model_path: Path = Path(__file__).resolve().parent / "models" / "vosk-model-small-de-0.15"
    openai_model: str = "gpt-4o-mini-transcribe"
    openai_prompt: str = (
        "Transcribe the spoken command exactly and concisely. "
        "Return only the spoken command, without comments."
    )
    fallback_to_vosk: bool = False
    write_text_file: bool = True


@dataclass(slots=True)
class ImpPluginIngressConfig:
    enabled: bool = True
    inbox_dir: Path = Path(__file__).resolve().parent / "imp-plugin-inbox"
    conversation_id: str = "imp-voice"
    user_id: str = "imp-voice"


@dataclass(slots=True)
class ConversationConfig:
    enabled: bool = True
    follow_up_timeout_seconds: float = 5.0
    response_wait_timeout_seconds: float = 0.0
    close_phrases: tuple[str, ...] = ()


@dataclass(slots=True)
class SpeakerFeedbackConfig:
    enabled: bool = False
    status_file: Path | None = None
    quiet_after_ms: int = 1000
    max_status_age_seconds: float = 120.0


@dataclass(slots=True)
class FeedbackToneConfig:
    enabled: bool = True
    device: str = "default"
    sample_rate: int = 16000
    quiet_after_ms: int = 150
    close_rearm_ms: int = 1500


@dataclass(slots=True)
class HealthConfig:
    status_file: Path | None = None


@dataclass(slots=True)
class RuntimeConfig:
    audio: AudioConfig
    wake_capture: WakeCaptureConfig
    wake_phrase: WakePhraseConfig
    command_recording: CommandRecordingConfig
    command_transcription: CommandTranscriptionConfig
    imp_plugin: ImpPluginIngressConfig
    conversation: ConversationConfig
    speaker_feedback: SpeakerFeedbackConfig
    feedback_tones: FeedbackToneConfig
    health: HealthConfig


class WakePhraseRecorder:
    def __init__(self, config: RuntimeConfig, once: bool = False) -> None:
        self.config = config
        self.once = once
        self.stop_requested = False
        self.saved_recordings = 0
        self.health_writer = HealthWriter(config.health.status_file, "wake-phrase")
        self.plugin_inbox_writer = PluginInboxWriter(
            config.imp_plugin.inbox_dir,
            config.imp_plugin.conversation_id,
            config.imp_plugin.user_id,
        )

        self.chunk_frames = max(1, self.config.audio.sample_rate * self.config.audio.chunk_ms // 1000)
        self.bytes_per_frame = 2 * self.config.audio.channels
        self.chunk_bytes = self.chunk_frames * self.bytes_per_frame

        self.wake_pre_roll_chunks = max(1, self.config.wake_capture.pre_roll_ms // self.config.audio.chunk_ms)
        self.command_pre_roll_chunks = max(1, self.config.command_recording.pre_roll_ms // self.config.audio.chunk_ms)
        self.command_silence_chunks = max(1, self.config.command_recording.silence_ms // self.config.audio.chunk_ms)

        self.wake_pre_roll_buffer: deque[bytes] = deque(maxlen=self.wake_pre_roll_chunks)
        self.command_pre_roll_buffer: deque[bytes] = deque(maxlen=self.command_pre_roll_chunks)

        self.state = "idle"
        self.cooldown_until = 0.0
        self.command_armed_until = 0.0
        self.command_listen_after = 0.0
        self.command_pending_after_delay = False
        self.awaiting_follow_up = False
        self.speaker_blocked_until = 0.0
        self.local_feedback_blocked_until = 0.0
        self.speaker_response_wait_until = 0.0
        self.speaker_response_seen = False
        self.listen_ready_status_at = 0.0
        self.listen_ready_phase = ""

        self.wake_trigger_streak = 0
        self.command_trigger_streak = 0
        self.command_silence_streak = 0

        self.command_chunks: list[bytes] = []
        self.command_chunk_count = 0
        self.command_start_ts = 0.0
        self.command_max_rms = 0
        self.command_trigger_rms = 0
        self.wake_result_text = ""
        self.wake_match_text = ""
        self.feedback_processes: list[subprocess.Popen[bytes]] = []

        SetLogLevel(-1)
        if self.config.wake_phrase.model_name not in openwakeword.models:
            known_models = ", ".join(sorted(openwakeword.models))
            raise RuntimeError(
                f"Unknown openWakeWord model: {self.config.wake_phrase.model_name}. "
                f"Known models: {known_models}"
            )
        self.wake_model_path = openwakeword.models[self.config.wake_phrase.model_name]["model_path"]
        self.wake_model = OpenWakeWordModel(wakeword_model_paths=[self.wake_model_path])
        self.wake_score_key = next(iter(self.wake_model.models.keys()))

        self.command_model: Model | None = None
        if self.config.command_transcription.enabled and (
            self.config.command_transcription.provider == "vosk"
            or self.config.command_transcription.fallback_to_vosk
        ):
            command_model_path = self.config.command_transcription.model_path.expanduser()
            if not command_model_path.exists():
                raise RuntimeError(
                    f"Command Vosk model is missing: {command_model_path}. "
                    "Install the model locally or update the configuration."
                )
            self.command_model = Model(model_path=str(command_model_path))

        self.openai_client: Any | None = None
        if self.config.command_transcription.enabled and self.config.command_transcription.provider == "openai":
            try:
                from openai import OpenAI

                self.openai_client = OpenAI()
            except Exception as exc:
                if not self.config.command_transcription.fallback_to_vosk:
                    raise RuntimeError(f"OpenAI transcription could not be initialized: {exc}") from exc
                self.log(f"OpenAI transcription is not available, using Vosk fallback: {exc}")

    @staticmethod
    def log(message: str) -> None:
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{stamp}] {message}", flush=True)

    def request_stop(self, *_args: object) -> None:
        self.stop_requested = True
        self.log("Stop requested, shutting down cleanly.")

    def ensure_arecord(self) -> str:
        arecord = shutil.which("arecord")
        if not arecord:
            raise RuntimeError("'arecord' was not found. Install 'alsa-utils'.")
        return arecord

    def spawn_arecord(self) -> subprocess.Popen[bytes]:
        arecord = self.ensure_arecord()
        cmd = [
            arecord,
            "-D",
            self.config.audio.device,
            "-q",
            "-f",
            "S16_LE",
            "-r",
            str(self.config.audio.sample_rate),
            "-c",
            str(self.config.audio.channels),
            "--buffer-time=200000",
            "--period-time=100000",
            "-t",
            "raw",
        ]
        self.log("Starting audio stream: " + " ".join(cmd))
        return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)

    def run(self) -> int:
        self.config.command_recording.output_dir.mkdir(parents=True, exist_ok=True)
        if self.config.imp_plugin.enabled:
            self.config.imp_plugin.inbox_dir.mkdir(parents=True, exist_ok=True)
        signal.signal(signal.SIGINT, self.request_stop)
        signal.signal(signal.SIGTERM, self.request_stop)

        proc = self.spawn_arecord()
        assert proc.stdout is not None
        fd = proc.stdout.fileno()
        stream_failed = False

        self.log(
            "Wake phrase recorder active: "
            f"display_name='{self.config.wake_phrase.display_name}', "
            f"openwakeword_model='{self.config.wake_phrase.model_name}', "
            f"threshold={self.config.wake_phrase.threshold}, "
            f"conversation_follow_up={'on' if self.config.conversation.enabled else 'off'} "
            f"({self.config.conversation.follow_up_timeout_seconds:.1f}s), "
            f"command_transcription={self.config.command_transcription.provider if self.config.command_transcription.enabled else 'off'}, "
            f"imp_plugin={'on' if self.config.imp_plugin.enabled else 'off'}, "
            f"feedback_tones={'on' if self.config.feedback_tones.enabled else 'off'}"
        )
        self.write_runtime_status("waiting_for_wake", can_speak=False)

        try:
            while not self.stop_requested:
                chunk = self.read_chunk(fd)
                if len(chunk) != self.chunk_bytes:
                    stream_failed = not self.stop_requested and proc.poll() not in (None, 0)
                    self.log("Audio stream was interrupted or ended.")
                    break
                self.handle_chunk(chunk)
        finally:
            if self.state == "recording_command" and self.command_chunks:
                self.finish_command_recording(reason="shutdown")
            return_code, _stderr = self.stop_process(proc)
            for feedback_proc in self.feedback_processes:
                if feedback_proc.poll() is None:
                    feedback_proc.terminate()
                    try:
                        feedback_proc.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        feedback_proc.kill()
                        feedback_proc.wait(timeout=1)

        if self.stop_requested:
            return 0
        if stream_failed and return_code:
            return return_code
        return 0

    def read_chunk(self, fd: int) -> bytes:
        parts: list[bytes] = []
        remaining = self.chunk_bytes
        while remaining > 0 and not self.stop_requested:
            part = os.read(fd, remaining)
            if not part:
                break
            parts.append(part)
            remaining -= len(part)
        return b"".join(parts)

    def write_runtime_status(self, phase: str, can_speak: bool, status: str = "active", **fields: Any) -> None:
        now = time.monotonic()
        payload: dict[str, Any] = {
            "state": self.state,
            "phase": phase,
            "can_speak": can_speak,
        }
        if self.state == "armed":
            payload["command_mode"] = "follow-up" if self.awaiting_follow_up else "wake"
            payload["listen_after_ms"] = max(0, int((self.command_listen_after - now) * 1000))
            payload["armed_remaining_ms"] = max(0, int((self.command_armed_until - now) * 1000))
        self.health_writer.write(status, **payload, **{key: value for key, value in fields.items() if value is not None})

    def schedule_listen_ready_status(self, phase: str) -> None:
        self.listen_ready_status_at = self.command_listen_after
        self.listen_ready_phase = phase

    def clear_listen_ready_status(self) -> None:
        self.listen_ready_status_at = 0.0
        self.listen_ready_phase = ""

    def publish_listen_ready_status_if_due(self, now: float) -> None:
        if self.listen_ready_status_at <= 0 or self.state != "armed" or now < self.listen_ready_status_at:
            return
        phase = self.listen_ready_phase or ("awaiting_follow_up" if self.awaiting_follow_up else "awaiting_command")
        self.clear_listen_ready_status()
        self.write_runtime_status(phase, can_speak=True)

    def reap_feedback_processes(self) -> None:
        alive: list[subprocess.Popen[bytes]] = []
        for proc in self.feedback_processes:
            if proc.poll() is None:
                alive.append(proc)
                continue
            try:
                proc.wait(timeout=0)
            except subprocess.TimeoutExpired:
                alive.append(proc)
        self.feedback_processes = alive

    def build_feedback_tone(self, name: str) -> tuple[bytes, float]:
        sample_rate = self.config.feedback_tones.sample_rate
        spacing_seconds = 0.015
        tone_map: dict[str, list[tuple[float, float, float]]] = {
            "ready": [(740.0, 0.045, 0.22), (988.0, 0.085, 0.26)],
            "follow-up-ready": [(880.0, 0.04, 0.22), (1174.0, 0.08, 0.26)],
            "captured": [(1174.0, 0.035, 0.22), (784.0, 0.07, 0.24)],
            "closed": [(880.0, 0.04, 0.2), (659.0, 0.06, 0.22), (440.0, 0.11, 0.24)],
        }
        segments = tone_map.get(name)
        if not segments:
            raise ValueError(f"Unknown feedback tone: {name}")

        samples = array("h")
        total_duration = 0.0
        fade_seconds = 0.005
        for index, (frequency, duration, amplitude) in enumerate(segments):
            frame_count = max(1, int(sample_rate * duration))
            fade_frames = min(frame_count // 2, max(1, int(sample_rate * fade_seconds)))
            for frame in range(frame_count):
                envelope = 1.0
                if fade_frames > 0:
                    if frame < fade_frames:
                        envelope = frame / fade_frames
                    elif frame >= frame_count - fade_frames:
                        envelope = (frame_count - frame - 1) / fade_frames
                sample = int(32767 * amplitude * envelope * math.sin(2 * math.pi * frequency * frame / sample_rate))
                samples.append(sample)
            total_duration += duration
            if index < len(segments) - 1:
                silence_frames = max(1, int(sample_rate * spacing_seconds))
                samples.extend([0] * silence_frames)
                total_duration += spacing_seconds

        with io.BytesIO() as buffer:
            with wave.open(buffer, "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(samples.tobytes())
            return buffer.getvalue(), total_duration

    def play_feedback_tone(self, name: str) -> float:
        if not self.config.feedback_tones.enabled:
            return 0.0

        aplay = shutil.which("aplay")
        if not aplay:
            self.log("Skipping feedback tone: 'aplay' was not found.")
            return 0.0

        try:
            wav_bytes, duration = self.build_feedback_tone(name)
            command = [aplay, "-q"]
            if self.config.feedback_tones.device:
                command.extend(["-D", self.config.feedback_tones.device])
            command.append("-")
            proc = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            assert proc.stdin is not None
            proc.stdin.write(wav_bytes)
            proc.stdin.close()
            self.feedback_processes.append(proc)
            block_seconds = duration + max(0.0, self.config.feedback_tones.quiet_after_ms / 1000)
            self.local_feedback_blocked_until = max(self.local_feedback_blocked_until, time.monotonic() + block_seconds)
            return block_seconds
        except Exception as exc:
            self.log(f"Feedback tone '{name}' could not be played: {exc}")
            return 0.0

    def is_local_feedback_blocked(self, now: float) -> bool:
        return now < self.local_feedback_blocked_until

    def handle_local_feedback_block(self, _now: float) -> None:
        self.wake_trigger_streak = 0
        self.command_trigger_streak = 0
        self.command_pending_after_delay = False
        self.command_pre_roll_buffer.clear()
        self.wake_pre_roll_buffer.clear()

    def handle_chunk(self, chunk: bytes) -> None:
        rms = self.compute_rms(chunk)
        now = time.monotonic()
        self.reap_feedback_processes()
        self.publish_listen_ready_status_if_due(now)

        if self.state == "waiting_for_speaker":
            self.handle_waiting_for_speaker(now)
            return

        if self.is_local_feedback_blocked(now):
            self.handle_local_feedback_block(now)
            return

        if self.is_speaker_feedback_blocked(now):
            self.handle_speaker_feedback_block(now)
            return

        if self.state == "idle":
            wake_score = self.predict_wake_score(chunk)
            self.wake_pre_roll_buffer.append(chunk)
            if now < self.cooldown_until:
                self.wake_trigger_streak = 0
                return

            if wake_score >= self.config.wake_phrase.log_threshold:
                self.log(
                    f"Wake-Score {self.config.wake_phrase.model_name}: "
                    f"{wake_score:.4f} threshold={self.config.wake_phrase.threshold:.4f}"
                )
            if wake_score >= self.config.wake_phrase.threshold:
                self.wake_trigger_streak += 1
            else:
                self.wake_trigger_streak = 0

            if self.wake_trigger_streak >= self.config.wake_capture.start_chunks:
                self.arm_command_recording(wake_score)
            return

        if self.state == "armed":
            if now > self.command_armed_until:
                if self.awaiting_follow_up:
                    self.log(
                        "Follow-up conversation closed: "
                        f"{self.config.conversation.follow_up_timeout_seconds:.1f}s of silence detected."
                    )
                    self.reset_to_idle(cooldown=False, closed_reason="follow-up-timeout", play_closed_tone=True)
                else:
                    self.log("Wake phrase detected, but no command started within the time window.")
                    self.reset_to_idle(cooldown=False, closed_reason="wake-timeout", play_closed_tone=True)
                    self.cooldown_until = now + self.config.wake_phrase.no_command_cooldown_seconds
                return

            if now < self.command_listen_after:
                if rms >= self.config.command_recording.start_threshold_rms:
                    self.command_pending_after_delay = True
                self.command_trigger_streak = 0
                return

            self.command_pre_roll_buffer.append(chunk)

            if self.command_pending_after_delay:
                self.start_command_recording(rms)
                return

            if rms >= self.config.command_recording.start_threshold_rms:
                self.command_trigger_streak += 1
            else:
                self.command_trigger_streak = 0

            if self.command_trigger_streak >= self.config.command_recording.start_chunks:
                self.start_command_recording(rms)
            return

        if self.state == "recording_command":
            self.command_chunks.append(chunk)
            self.command_chunk_count += 1
            self.command_max_rms = max(self.command_max_rms, rms)

            if rms >= self.config.command_recording.stop_threshold_rms:
                self.command_silence_streak = 0
            else:
                self.command_silence_streak += 1

            duration = self.command_chunk_count * self.config.audio.chunk_ms / 1000
            if duration >= self.config.command_recording.max_seconds:
                self.finish_command_recording(reason="max-duration")
                return

            if duration >= self.config.command_recording.min_seconds and self.command_silence_streak >= self.command_silence_chunks:
                self.finish_command_recording(reason="silence")
            return

        raise RuntimeError(f"Unbekannter Zustand: {self.state}")

    def handle_waiting_for_speaker(self, now: float) -> None:
        if self.is_local_feedback_blocked(now):
            self.handle_local_feedback_block(now)
            return

        if self.is_speaker_feedback_blocked(now):
            self.speaker_response_seen = True
            self.handle_speaker_feedback_block(now)
            return

        if self.speaker_response_seen and now >= self.speaker_blocked_until:
            self.log("Speaker response ended, opening follow-up window.")
            self.arm_follow_up_recording()
            return

        if self.speaker_response_wait_until > 0 and now > self.speaker_response_wait_until:
            self.log(
                "No speaker response was detected within the wait window; "
                "opening the follow-up window anyway."
            )
            self.arm_follow_up_recording()
            return

        self.wake_trigger_streak = 0
        self.command_trigger_streak = 0
        self.command_pending_after_delay = False
        self.command_pre_roll_buffer.clear()
        self.wake_pre_roll_buffer.clear()

    def is_speaker_feedback_blocked(self, now: float) -> bool:
        if now < self.speaker_blocked_until:
            return True
        feedback = self.config.speaker_feedback
        if not feedback.enabled or not feedback.status_file:
            return False

        try:
            payload = json.loads(feedback.status_file.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return False

        if payload.get("status") != "speaking":
            return False

        updated_at = payload.get("updatedAt")
        if isinstance(updated_at, str):
            try:
                updated = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
            except ValueError:
                updated = None
            if updated:
                if updated.tzinfo is None:
                    updated = updated.replace(tzinfo=timezone.utc)
                age = (datetime.now(timezone.utc) - updated.astimezone(timezone.utc)).total_seconds()
                if age > feedback.max_status_age_seconds:
                    return False

        self.speaker_blocked_until = now + max(0.0, feedback.quiet_after_ms / 1000)
        return True

    def handle_speaker_feedback_block(self, now: float) -> None:
        self.wake_trigger_streak = 0
        self.command_trigger_streak = 0
        self.command_pending_after_delay = False
        self.command_pre_roll_buffer.clear()
        self.wake_pre_roll_buffer.clear()
        if self.state == "armed" and self.awaiting_follow_up:
            timeout = self.config.conversation.follow_up_timeout_seconds
            self.command_listen_after = max(self.command_listen_after, self.speaker_blocked_until)
            self.command_armed_until = max(self.command_armed_until, self.speaker_blocked_until + timeout)

    def predict_wake_score(self, chunk: bytes) -> float:
        audio = np.frombuffer(chunk, dtype="<i2").copy()
        scores = self.wake_model.predict(audio)
        return float(scores.get(self.wake_score_key, 0.0))

    def arm_command_recording(self, wake_score: float) -> None:
        self.state = "armed"
        self.awaiting_follow_up = False
        self.wake_trigger_streak = 0
        now = time.monotonic()
        delay_seconds = max(0.0, self.config.wake_phrase.command_start_delay_ms / 1000)
        cue_block_seconds = self.play_feedback_tone("ready")
        self.command_listen_after = now + max(delay_seconds, cue_block_seconds)
        self.command_armed_until = now + self.config.wake_phrase.command_timeout_seconds + max(
            delay_seconds,
            cue_block_seconds,
        )
        self.command_pre_roll_buffer.clear()
        self.command_trigger_streak = 0
        self.command_pending_after_delay = False
        self.wake_result_text = self.config.wake_phrase.model_name
        self.wake_match_text = self.config.wake_phrase.display_name
        self.schedule_listen_ready_status("awaiting_command")
        self.write_runtime_status(
            "awaiting_command",
            can_speak=False,
            cue=("ready" if cue_block_seconds > 0 else None),
            wake_score=round(wake_score, 4),
        )
        self.log(
            f"Wake phrase detected: {self.config.wake_phrase.display_name} "
            f"(score={wake_score:.4f}). Waiting {max(delay_seconds, cue_block_seconds):.1f}s for the command."
        )

    def arm_follow_up_recording(self) -> None:
        self.state = "armed"
        self.awaiting_follow_up = True
        now = time.monotonic()
        cue_block_seconds = self.play_feedback_tone("follow-up-ready")
        self.command_listen_after = now + cue_block_seconds
        self.command_armed_until = now + self.config.conversation.follow_up_timeout_seconds + cue_block_seconds
        self.command_pre_roll_buffer.clear()
        self.command_trigger_streak = 0
        self.command_pending_after_delay = False
        self.schedule_listen_ready_status("awaiting_follow_up")
        self.write_runtime_status(
            "awaiting_follow_up",
            can_speak=False,
            cue=("follow-up-ready" if cue_block_seconds > 0 else None),
        )
        self.log(
            "Follow-up conversation remains open. "
            f"Waiting {self.config.conversation.follow_up_timeout_seconds:.1f}s for the next command without a wake phrase."
        )

    def wait_for_speaker_response(self) -> None:
        self.state = "waiting_for_speaker"
        self.awaiting_follow_up = False
        self.clear_listen_ready_status()
        now = time.monotonic()
        wait_timeout = self.config.conversation.response_wait_timeout_seconds
        self.speaker_response_wait_until = now + wait_timeout if wait_timeout > 0 else 0.0
        self.speaker_response_seen = False
        self.command_pre_roll_buffer.clear()
        self.wake_pre_roll_buffer.clear()
        self.command_trigger_streak = 0
        self.command_pending_after_delay = False
        self.write_runtime_status("waiting_for_speaker", can_speak=False)
        timeout_text = f"{wait_timeout:.1f}s timeout" if wait_timeout > 0 else "no timeout"
        self.log(f"Waiting for the speaker response before opening the follow-up window ({timeout_text}).")

    def transcribe_command_audio(self, audio: bytes) -> str:
        if not self.config.command_transcription.enabled:
            return ""

        if self.config.command_transcription.provider == "openai":
            try:
                return self.transcribe_command_audio_openai(audio)
            except Exception as exc:
                self.log(f"OpenAI transcription failed: {exc}")
                if not self.config.command_transcription.fallback_to_vosk:
                    return ""
                self.log("Using Vosk fallback for command transcription.")

        return self.transcribe_command_audio_vosk(audio)

    def transcribe_command_audio_openai(self, audio: bytes) -> str:
        if self.openai_client is None:
            raise RuntimeError("OpenAI-Client ist nicht initialisiert.")

        path = self.write_temp_command_audio(audio)
        try:
            with path.open("rb") as audio_file:
                result = self.openai_client.audio.transcriptions.create(
                    model=self.config.command_transcription.openai_model,
                    file=audio_file,
                    response_format="text",
                    prompt=self.config.command_transcription.openai_prompt,
                )
            if isinstance(result, str):
                return result.strip()
            text = getattr(result, "text", None)
            if text is not None:
                return str(text).strip()
            if isinstance(result, dict):
                return str(result.get("text", "")).strip()
            return str(result).strip()
        finally:
            try:
                path.unlink()
            except FileNotFoundError:
                pass

    def transcribe_command_audio_vosk(self, audio: bytes) -> str:
        if not self.command_model:
            return ""

        recognizer = KaldiRecognizer(self.command_model, self.config.audio.sample_rate)
        recognizer.SetWords(False)
        offset = 0
        frame_bytes = self.chunk_bytes * 8
        while offset < len(audio):
            recognizer.AcceptWaveform(audio[offset : offset + frame_bytes])
            offset += frame_bytes

        result = json.loads(recognizer.FinalResult())
        return result.get("text", "").strip()

    def is_close_phrase(self, text: str) -> bool:
        normalized = self.normalize_text(text)
        if not normalized:
            return False
        close_phrases = {phrase for phrase in map(self.normalize_text, self.config.conversation.close_phrases) if phrase}
        return normalized in close_phrases

    def write_temp_command_audio(self, audio: bytes) -> Path:
        output_dir = self.config.command_recording.output_dir
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / f".transcribe-{time.time_ns()}.wav"
        with wave.open(str(path), "wb") as wav_file:
            wav_file.setnchannels(self.config.audio.channels)
            wav_file.setsampwidth(2)
            wav_file.setframerate(self.config.audio.sample_rate)
            wav_file.writeframes(audio)
        return path

    def start_command_recording(self, trigger_rms: int) -> None:
        mode = "follow-up" if self.awaiting_follow_up else "wake"
        self.state = "recording_command"
        self.clear_listen_ready_status()
        self.command_chunks = list(self.command_pre_roll_buffer)
        self.command_chunk_count = len(self.command_chunks)
        self.command_start_ts = time.time()
        self.command_max_rms = trigger_rms
        self.command_trigger_rms = trigger_rms
        self.command_silence_streak = 0
        self.command_trigger_streak = 0
        self.write_runtime_status("recording_command", can_speak=False, command_mode=mode)
        self.log(
            f"Command detected, starting recording ({mode}). "
            f"pre_roll_chunks={len(self.command_chunks)}, rms={trigger_rms}"
        )

    def finish_command_recording(self, reason: str) -> None:
        raw = b"".join(self.command_chunks)
        path = self.timestamped_recording_path()
        with wave.open(str(path), "wb") as wav_file:
            wav_file.setnchannels(self.config.audio.channels)
            wav_file.setsampwidth(2)
            wav_file.setframerate(self.config.audio.sample_rate)
            wav_file.writeframes(raw)

        duration = self.command_chunk_count * self.config.audio.chunk_ms / 1000
        captured_cue_seconds = self.play_feedback_tone("captured")
        self.write_runtime_status(
            "transcribing_command",
            can_speak=False,
            cue=("captured" if captured_cue_seconds > 0 else None),
            recording_file=str(path),
            finish_reason=reason,
        )
        transcript = self.transcribe_command_audio(raw)
        self.saved_recordings += 1
        self.log(
            f"Command recording saved: {path} ({duration:.1f}s, reason={reason}, wake='{self.wake_result_text or '-'}')"
        )
        if transcript:
            self.log(f"Command transcript: {transcript}")

        metadata = {
            "created_at": datetime.fromtimestamp(self.command_start_ts, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
            "file": str(path),
            "duration_seconds": duration,
            "audio_device": self.config.audio.device,
            "sample_rate": self.config.audio.sample_rate,
            "channels": self.config.audio.channels,
            "wake_phrase_display_name": self.config.wake_phrase.display_name,
            "wake_phrase_recognized_text": self.wake_result_text,
            "wake_phrase_matched_as": self.wake_match_text,
            "command_mode": "follow-up" if self.awaiting_follow_up else "wake",
            "conversation_follow_up_enabled": self.config.conversation.enabled,
            "conversation_follow_up_timeout_seconds": self.config.conversation.follow_up_timeout_seconds,
            "command_trigger_rms": self.command_trigger_rms,
            "command_max_rms": self.command_max_rms,
            "finish_reason": reason,
            "command_transcription_enabled": self.config.command_transcription.enabled,
            "command_transcription_provider": self.config.command_transcription.provider,
            "command_transcription_model": (
                self.config.command_transcription.openai_model
                if self.config.command_transcription.provider == "openai"
                else str(self.config.command_transcription.model_path)
            ),
            "command_text": transcript,
        }

        if self.config.command_transcription.enabled and self.config.command_transcription.write_text_file:
            path.with_suffix(".txt").write_text(transcript + "\n", encoding="utf-8")

        if self.config.command_recording.write_metadata:
            path.with_suffix(".json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

        if self.awaiting_follow_up and self.is_close_phrase(transcript):
            self.log("Follow-up conversation closed by local close phrase.")
            self.health_writer.write(
                "recorded",
                state=self.state,
                phase="conversation_closed",
                can_speak=False,
                recording_file=str(path),
                command_text=transcript,
                finish_reason=reason,
                closed_reason="close-phrase",
            )
            self.command_chunks = []
            self.command_chunk_count = 0
            self.command_max_rms = 0
            self.command_trigger_rms = 0
            self.reset_to_idle(cooldown=False, closed_reason="close-phrase", play_closed_tone=True)
            return

        imp_event_path: Path | None = None
        if self.config.imp_plugin.enabled:
            if transcript:
                imp_event_path = self.write_imp_plugin_event(path, transcript, metadata)
            else:
                self.log("No command transcript is available; not writing an imp plugin event.")

        self.health_writer.write(
            "recorded",
            state=self.state,
            phase="command_recorded",
            can_speak=False,
            recording_file=str(path),
            command_text=transcript,
            finish_reason=reason,
            imp_event_file=str(imp_event_path) if imp_event_path else None,
        )

        self.command_chunks = []
        self.command_chunk_count = 0
        self.command_max_rms = 0
        self.command_trigger_rms = 0

        if self.once:
            self.log("--once active, exiting after the first recording.")
            self.stop_requested = True
            return

        if self.config.conversation.enabled and self.config.speaker_feedback.enabled:
            self.wait_for_speaker_response()
            return

        if self.config.conversation.enabled:
            self.arm_follow_up_recording()
            return

        self.reset_to_idle(cooldown=True)

    def reset_to_idle(
        self,
        cooldown: bool,
        closed_reason: str | None = None,
        play_closed_tone: bool = False,
    ) -> None:
        self.state = "idle"
        self.cooldown_until = 0.0
        self.command_armed_until = 0.0
        self.wake_trigger_streak = 0
        self.command_trigger_streak = 0
        self.command_silence_streak = 0
        self.command_chunks = []
        self.command_chunk_count = 0
        self.wake_result_text = ""
        self.wake_match_text = ""
        self.command_listen_after = 0.0
        self.command_pending_after_delay = False
        self.awaiting_follow_up = False
        self.speaker_response_wait_until = 0.0
        self.speaker_response_seen = False
        self.local_feedback_blocked_until = 0.0
        self.clear_listen_ready_status()
        self.command_pre_roll_buffer.clear()
        self.wake_pre_roll_buffer.clear()
        if cooldown:
            self.cooldown_until = time.monotonic() + self.config.wake_capture.cooldown_seconds
        cue_name = "closed" if play_closed_tone else None
        if play_closed_tone:
            self.play_feedback_tone("closed")
            close_rearm_seconds = max(0.0, self.config.feedback_tones.close_rearm_ms / 1000)
            self.cooldown_until = max(self.cooldown_until, time.monotonic() + close_rearm_seconds)
        self.write_runtime_status(
            "waiting_for_wake",
            can_speak=False,
            closed_reason=closed_reason,
            cue=cue_name,
        )

    def timestamped_recording_path(self) -> Path:
        stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        return self.config.command_recording.output_dir / f"command-{stamp}.wav"

    def write_imp_plugin_event(self, recording_path: Path, transcript: str, metadata: dict[str, Any]) -> Path:
        final_path = self.plugin_inbox_writer.write_event(recording_path, transcript, metadata)
        self.log(f"imp plugin event written: {final_path}")
        return final_path

    @staticmethod
    def stop_process(proc: subprocess.Popen[bytes]) -> tuple[int | None, str]:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=3)

        stderr = ""
        if proc.stderr:
            stderr = proc.stderr.read().decode("utf-8", errors="replace").strip()
            if stderr and "Interrupted system call" not in stderr:
                print(stderr, file=sys.stderr, flush=True)
        return proc.returncode, stderr

    @staticmethod
    def compute_rms(chunk: bytes) -> int:
        samples = array("h")
        samples.frombytes(chunk)
        if sys.byteorder != "little":
            samples.byteswap()
        if not samples:
            return 0
        sum_squares = sum(sample * sample for sample in samples)
        return math.isqrt(sum_squares // len(samples))

    @staticmethod
    def normalize_text(text: str) -> str:
        text = unicodedata.normalize("NFKC", text).casefold().strip()
        text = re.sub(r"['’`´]", "", text)
        text = "".join(character if character.isalnum() else " " for character in text)
        text = re.sub(r"\s+", " ", text).strip()
        return text



def load_config(path: Path) -> RuntimeConfig:
    data: dict[str, Any] = tomllib.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

    audio_data = data.get("audio", {})
    wake_capture_data = data.get("wake_capture", {})
    wake_phrase_data = data.get("wake_phrase", {})
    command_data = data.get("command_recording", {})
    command_transcription_data = data.get("command_transcription", {})
    imp_plugin_data = data.get("imp_plugin", {})
    conversation_data = data.get("conversation", {})
    speaker_feedback_data = data.get("speaker_feedback", {})
    feedback_tones_data = data.get("feedback_tones", {})
    health_data = data.get("health", {})
    audio_defaults = AudioConfig()
    wake_capture_defaults = WakeCaptureConfig()
    wake_phrase_defaults = WakePhraseConfig()
    command_defaults = CommandRecordingConfig()
    command_transcription_defaults = CommandTranscriptionConfig()
    imp_plugin_defaults = ImpPluginIngressConfig()
    conversation_defaults = ConversationConfig()
    speaker_feedback_defaults = SpeakerFeedbackConfig()
    feedback_tones_defaults = FeedbackToneConfig()
    plugin_runtime_dir = optional_path(os.environ.get("IMP_VOICE_RUNTIME_DIR"), None)
    default_recordings_dir = optional_path(
        os.environ.get("IMP_VOICE_RECORDINGS_DIR"),
        command_defaults.output_dir,
    )
    default_inbox_dir = (
        plugin_runtime_dir / "inbox"
        if plugin_runtime_dir
        else imp_plugin_defaults.inbox_dir
    )
    default_speaker_status_file = (
        plugin_runtime_dir / "speaker-status.json"
        if plugin_runtime_dir
        else speaker_feedback_defaults.status_file
    )
    default_health_status_file = (
        plugin_runtime_dir / "wake-status.json"
        if plugin_runtime_dir
        else None
    )

    wake_phrase = WakePhraseConfig(
        display_name=str(wake_phrase_data.get("display_name", wake_phrase_defaults.display_name)),
        model_name=str(wake_phrase_data.get("model_name", wake_phrase_defaults.model_name)),
        threshold=float(wake_phrase_data.get("threshold", wake_phrase_defaults.threshold)),
        log_threshold=float(wake_phrase_data.get("log_threshold", wake_phrase_defaults.log_threshold)),
        command_timeout_seconds=float(
            wake_phrase_data.get("command_timeout_seconds", wake_phrase_defaults.command_timeout_seconds)
        ),
        command_start_delay_ms=int(
            wake_phrase_data.get("command_start_delay_ms", wake_phrase_defaults.command_start_delay_ms)
        ),
        no_command_cooldown_seconds=float(
            wake_phrase_data.get("no_command_cooldown_seconds", wake_phrase_defaults.no_command_cooldown_seconds)
        ),
    )

    return RuntimeConfig(
        audio=AudioConfig(
            device=str(audio_data.get("device", audio_defaults.device)),
            sample_rate=int(audio_data.get("sample_rate", audio_defaults.sample_rate)),
            channels=int(audio_data.get("channels", audio_defaults.channels)),
            chunk_ms=int(audio_data.get("chunk_ms", audio_defaults.chunk_ms)),
        ),
        wake_capture=WakeCaptureConfig(
            start_chunks=int(wake_capture_data.get("start_chunks", wake_capture_defaults.start_chunks)),
            pre_roll_ms=int(wake_capture_data.get("pre_roll_ms", wake_capture_defaults.pre_roll_ms)),
            cooldown_seconds=float(wake_capture_data.get("cooldown_seconds", wake_capture_defaults.cooldown_seconds)),
        ),
        wake_phrase=wake_phrase,
        command_recording=CommandRecordingConfig(
            start_threshold_rms=int(command_data.get("start_threshold_rms", command_defaults.start_threshold_rms)),
            start_chunks=int(command_data.get("start_chunks", command_defaults.start_chunks)),
            stop_threshold_rms=int(command_data.get("stop_threshold_rms", command_defaults.stop_threshold_rms)),
            silence_ms=int(command_data.get("silence_ms", command_defaults.silence_ms)),
            pre_roll_ms=int(command_data.get("pre_roll_ms", command_defaults.pre_roll_ms)),
            min_seconds=float(command_data.get("min_seconds", command_defaults.min_seconds)),
            max_seconds=float(command_data.get("max_seconds", command_defaults.max_seconds)),
            output_dir=required_path(command_data.get("output_dir"), default_recordings_dir),
            write_metadata=bool(command_data.get("write_metadata", command_defaults.write_metadata)),
        ),
        command_transcription=CommandTranscriptionConfig(
            enabled=bool(command_transcription_data.get("enabled", command_transcription_defaults.enabled)),
            provider=str(command_transcription_data.get("provider", command_transcription_defaults.provider)),
            model_path=required_path(
                command_transcription_data.get("model_path"),
                optional_path(os.environ.get("IMP_VOICE_VOSK_MODEL_PATH"), command_transcription_defaults.model_path),
            ),
            openai_model=str(command_transcription_data.get("openai_model", command_transcription_defaults.openai_model)),
            openai_prompt=str(
                command_transcription_data.get("openai_prompt", command_transcription_defaults.openai_prompt)
            ),
            fallback_to_vosk=bool(
                command_transcription_data.get("fallback_to_vosk", command_transcription_defaults.fallback_to_vosk)
            ),
            write_text_file=bool(
                command_transcription_data.get("write_text_file", command_transcription_defaults.write_text_file)
            ),
        ),
        imp_plugin=ImpPluginIngressConfig(
            enabled=bool(imp_plugin_data.get("enabled", imp_plugin_defaults.enabled)),
            inbox_dir=required_path(imp_plugin_data.get("inbox_dir"), default_inbox_dir),
            conversation_id=str(imp_plugin_data.get("conversation_id", imp_plugin_defaults.conversation_id)),
            user_id=str(imp_plugin_data.get("user_id", imp_plugin_defaults.user_id)),
        ),
        conversation=ConversationConfig(
            enabled=bool(conversation_data.get("enabled", conversation_defaults.enabled)),
            follow_up_timeout_seconds=float(
                conversation_data.get("follow_up_timeout_seconds", conversation_defaults.follow_up_timeout_seconds)
            ),
            response_wait_timeout_seconds=float(
                conversation_data.get(
                    "response_wait_timeout_seconds",
                    conversation_defaults.response_wait_timeout_seconds,
                )
            ),
            close_phrases=tuple(str(phrase) for phrase in conversation_data.get("close_phrases", [])),
        ),
        speaker_feedback=SpeakerFeedbackConfig(
            enabled=bool(speaker_feedback_data.get("enabled", speaker_feedback_defaults.enabled)),
            status_file=optional_path(speaker_feedback_data.get("status_file"), default_speaker_status_file),
            quiet_after_ms=int(speaker_feedback_data.get("quiet_after_ms", speaker_feedback_defaults.quiet_after_ms)),
            max_status_age_seconds=float(
                speaker_feedback_data.get(
                    "max_status_age_seconds",
                    speaker_feedback_defaults.max_status_age_seconds,
                )
            ),
        ),
        feedback_tones=FeedbackToneConfig(
            enabled=bool(feedback_tones_data.get("enabled", feedback_tones_defaults.enabled)),
            device=str(feedback_tones_data.get("device", feedback_tones_defaults.device)),
            sample_rate=int(feedback_tones_data.get("sample_rate", feedback_tones_defaults.sample_rate)),
            quiet_after_ms=int(feedback_tones_data.get("quiet_after_ms", feedback_tones_defaults.quiet_after_ms)),
            close_rearm_ms=int(feedback_tones_data.get("close_rearm_ms", feedback_tones_defaults.close_rearm_ms)),
        ),
        health=HealthConfig(
            status_file=optional_path(health_data.get("status_file"), default_health_status_file),
        ),
    )


def required_path(value: object, fallback: Path) -> Path:
    return optional_path(value, fallback) or fallback


def optional_path(value: object, fallback: Path | None) -> Path | None:
    if value is None or value == "":
        return fallback
    expanded = os.path.expandvars(os.path.expanduser(str(value)))
    if "$" in expanded:
        return fallback
    return Path(expanded)



def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local wake phrase recorder with openWakeWord, Vosk, and arecord.")
    parser.add_argument(
        "--config",
        default=str(DEFAULT_CONFIG_PATH),
        help=f"Path to the TOML configuration (default: {DEFAULT_CONFIG_PATH})",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Exit after the first saved command recording.",
    )
    return parser.parse_args()



def main() -> int:
    args = parse_args()
    config = load_config(Path(args.config).expanduser())
    recorder = WakePhraseRecorder(config=config, once=args.once)
    return recorder.run()


if __name__ == "__main__":
    raise SystemExit(main())

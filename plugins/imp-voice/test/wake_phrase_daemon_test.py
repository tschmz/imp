from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path


class _FakeNumpyArray:
    def copy(self):
        return self


class _FakeOpenWakeWordModel:
    def __init__(self, wakeword_model_paths: list[str]) -> None:
        self.models = {"fake": object()}

    def predict(self, _audio):
        return {"fake": 0.0}


class _FakeVoskModel:
    def __init__(self, model_path: str) -> None:
        self.model_path = model_path


class _FakeKaldiRecognizer:
    def __init__(self, _model, _sample_rate: int, _grammar=None) -> None:
        self._result = '{"text": ""}'

    def SetWords(self, _value: bool) -> None:
        return

    def AcceptWaveform(self, _audio: bytes) -> bool:
        return True

    def FinalResult(self) -> str:
        return self._result


numpy_module = types.ModuleType("numpy")
numpy_module.frombuffer = lambda _buffer, dtype=None: _FakeNumpyArray()
sys.modules.setdefault("numpy", numpy_module)

openwakeword_module = types.ModuleType("openwakeword")
openwakeword_module.models = {"hey_jarvis": {"model_path": "/tmp/fake-wake.onnx"}}
openwakeword_model_module = types.ModuleType("openwakeword.model")
openwakeword_model_module.Model = _FakeOpenWakeWordModel

vosk_module = types.ModuleType("vosk")
vosk_module.Model = _FakeVoskModel
vosk_module.KaldiRecognizer = _FakeKaldiRecognizer
vosk_module.SetLogLevel = lambda _level: None

sys.modules.setdefault("openwakeword", openwakeword_module)
sys.modules.setdefault("openwakeword.model", openwakeword_model_module)
sys.modules.setdefault("vosk", vosk_module)
tomllib_module = types.ModuleType("tomllib")
tomllib_module.loads = lambda text: json.loads(text) if text.strip().startswith("{") else {}
sys.modules.setdefault("tomllib", tomllib_module)

MODULE_PATH = Path(__file__).resolve().parents[1] / "bin" / "wake-phrase-daemon.py"
SPEC = importlib.util.spec_from_file_location("wake_phrase_daemon", MODULE_PATH)
assert SPEC and SPEC.loader
wake_phrase_daemon = importlib.util.module_from_spec(SPEC)
sys.modules["wake_phrase_daemon"] = wake_phrase_daemon
SPEC.loader.exec_module(wake_phrase_daemon)


class _HealthWriterStub:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def write(self, status: str, **payload: object) -> None:
        self.calls.append((status, payload))


class WakePhraseDaemonStateTests(unittest.TestCase):
    def create_recorder(self):
        config = wake_phrase_daemon.RuntimeConfig(
            audio=wake_phrase_daemon.AudioConfig(),
            wake_capture=wake_phrase_daemon.WakeCaptureConfig(start_chunks=2),
            wake_phrase=wake_phrase_daemon.WakePhraseConfig(threshold=0.5, log_threshold=0.0),
            command_recording=wake_phrase_daemon.CommandRecordingConfig(),
            command_transcription=wake_phrase_daemon.CommandTranscriptionConfig(enabled=False),
            imp_plugin=wake_phrase_daemon.ImpPluginIngressConfig(enabled=False),
            conversation=wake_phrase_daemon.ConversationConfig(enabled=False),
            speaker_feedback=wake_phrase_daemon.SpeakerFeedbackConfig(enabled=False),
            feedback_tones=wake_phrase_daemon.FeedbackToneConfig(enabled=False),
            health=wake_phrase_daemon.HealthConfig(status_file=None),
        )
        recorder = wake_phrase_daemon.WakePhraseRecorder(config=config)
        recorder.health_writer = _HealthWriterStub()
        return recorder

    def test_idle_to_armed_after_wake_streak(self):
        recorder = self.create_recorder()
        recorder.predict_wake_score = lambda _chunk: 0.9
        chunk = b"\x00" * recorder.chunk_bytes

        recorder.handle_chunk(chunk)
        self.assertEqual(recorder.state, "idle")

        recorder.handle_chunk(chunk)
        self.assertEqual(recorder.state, "armed")
        self.assertGreater(recorder.command_armed_until, 0)

        last_status, last_payload = recorder.health_writer.calls[-1]
        self.assertEqual(last_status, "active")
        self.assertEqual(last_payload["phase"], "awaiting_command")
        self.assertEqual(last_payload["state"], "armed")

    def test_armed_timeout_returns_to_idle_and_reports_phase(self):
        recorder = self.create_recorder()
        recorder.arm_command_recording(0.95)
        recorder.command_armed_until = 0

        chunk = b"\x00" * recorder.chunk_bytes
        recorder.handle_chunk(chunk)

        self.assertEqual(recorder.state, "idle")
        self.assertGreater(recorder.cooldown_until, 0)

        last_status, last_payload = recorder.health_writer.calls[-1]
        self.assertEqual(last_status, "active")
        self.assertEqual(last_payload["phase"], "waiting_for_wake")
        self.assertEqual(last_payload["closed_reason"], "wake-timeout")

    def test_captured_feedback_tone_is_available(self):
        recorder = self.create_recorder()

        wav_bytes, duration = recorder.build_feedback_tone("captured")

        self.assertGreater(len(wav_bytes), 44)
        self.assertGreater(duration, 0)

    def test_follow_up_ready_tone_is_shorter_than_wake_ready_tone(self):
        recorder = self.create_recorder()

        _ready_bytes, ready_duration = recorder.build_feedback_tone("ready")
        follow_up_bytes, follow_up_duration = recorder.build_feedback_tone("follow-up-ready")

        self.assertGreater(len(follow_up_bytes), 44)
        self.assertLess(follow_up_duration, ready_duration)

    def test_accepted_feedback_tone_is_available(self):
        recorder = self.create_recorder()

        wav_bytes, duration = recorder.build_feedback_tone("accepted")

        self.assertGreater(len(wav_bytes), 44)
        self.assertGreater(duration, 0)

    def test_error_feedback_tone_is_available(self):
        recorder = self.create_recorder()

        wav_bytes, duration = recorder.build_feedback_tone("error")

        self.assertGreater(len(wav_bytes), 44)
        self.assertGreater(duration, 0)

    def test_empty_transcript_returns_to_idle_instead_of_waiting_for_speaker(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            recorder = self.create_recorder()
            recorder.config.command_recording.output_dir = Path(temp_dir)
            recorder.config.conversation.enabled = True
            recorder.config.speaker_feedback.enabled = True
            recorder.state = "recording_command"
            recorder.command_chunks = [b"\x00" * recorder.chunk_bytes]
            recorder.command_chunk_count = 1
            recorder.command_start_ts = 0.0

            recorder.finish_command_recording(reason="silence")

            self.assertEqual(recorder.state, "idle")
            self.assertGreater(recorder.cooldown_until, 0)
            self.assertFalse(recorder.stop_requested)

    def test_waiting_for_speaker_has_no_timeout_when_disabled(self):
        recorder = self.create_recorder()
        recorder.config.conversation.enabled = True
        recorder.config.conversation.response_wait_timeout_seconds = 0.0
        recorder.config.speaker_feedback.enabled = True

        recorder.wait_for_speaker_response()
        self.assertEqual(recorder.speaker_response_wait_until, 0.0)

        recorder.handle_waiting_for_speaker(10**12)

        self.assertEqual(recorder.state, "waiting_for_speaker")
        self.assertFalse(recorder.awaiting_follow_up)

    def test_close_phrase_matches_only_configured_normalized_phrase(self):
        recorder = self.create_recorder()
        recorder.config.conversation.close_phrases = ("stop now",)

        self.assertTrue(recorder.is_close_phrase(" Stop, now! "))
        self.assertEqual(wake_phrase_daemon.WakePhraseRecorder.normalize_text("that's it"), "thats it")
        self.assertFalse(recorder.is_close_phrase("stop now please"))

    def test_waiting_for_speaker_timeout_still_opens_follow_up_when_configured(self):
        recorder = self.create_recorder()
        recorder.config.conversation.enabled = True
        recorder.config.conversation.response_wait_timeout_seconds = 1.0
        recorder.config.speaker_feedback.enabled = True

        recorder.wait_for_speaker_response()
        recorder.handle_waiting_for_speaker(recorder.speaker_response_wait_until + 1)

        self.assertEqual(recorder.state, "armed")
        self.assertTrue(recorder.awaiting_follow_up)


if __name__ == "__main__":
    unittest.main()

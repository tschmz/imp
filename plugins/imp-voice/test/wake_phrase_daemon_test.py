from __future__ import annotations

import importlib.util
import sys
import tempfile
import types
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace


class WakePhraseRecorderPathTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._stub_runtime_deps()
        daemon_path = Path(__file__).resolve().parent.parent / "bin" / "wake-phrase-daemon.py"
        spec = importlib.util.spec_from_file_location("wake_phrase_daemon", daemon_path)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        cls.daemon = module

    @staticmethod
    def _stub_runtime_deps() -> None:
        tomllib = types.ModuleType("tomllib")
        tomllib.loads = lambda _text: {}
        tomllib.load = lambda _fp: {}
        sys.modules.setdefault("tomllib", tomllib)

        openwakeword = types.ModuleType("openwakeword")
        openwakeword.models = {"hey_jarvis": {"model_path": "dummy"}}
        openwakeword_model = types.ModuleType("openwakeword.model")

        class DummyOpenWakeWordModel:
            def __init__(self, *args, **kwargs) -> None:
                self.models = {"dummy": object()}

        openwakeword_model.Model = DummyOpenWakeWordModel
        sys.modules.setdefault("openwakeword", openwakeword)
        sys.modules.setdefault("openwakeword.model", openwakeword_model)

        vosk = types.ModuleType("vosk")

        class DummyVoskModel:
            def __init__(self, *args, **kwargs) -> None:
                pass

        class DummyRecognizer:
            def __init__(self, *args, **kwargs) -> None:
                pass

            def SetWords(self, *_args) -> None:
                pass

            def AcceptWaveform(self, *_args) -> None:
                pass

            def FinalResult(self) -> str:
                return '{"text": ""}'

        def dummy_set_log_level(*_args) -> None:
            return None

        vosk.Model = DummyVoskModel
        vosk.KaldiRecognizer = DummyRecognizer
        vosk.SetLogLevel = dummy_set_log_level
        sys.modules.setdefault("vosk", vosk)

    def test_fast_recordings_keep_both_files_and_sidecars(self) -> None:
        with tempfile.TemporaryDirectory(prefix="imp-voice-fast-recordings-") as tmp:
            output_dir = Path(tmp)
            recorder = self._build_recorder(output_dir)

            recorder.finish_command_recording(reason="test-1")
            recorder.command_start_ts += 0.001
            recorder.finish_command_recording(reason="test-2")

            wavs = sorted(output_dir.glob("*.wav"))
            txts = sorted(output_dir.glob("*.txt"))
            jsons = sorted(output_dir.glob("*.json"))

            self.assertEqual(len(wavs), 2)
            self.assertEqual(len(txts), 2)
            self.assertEqual(len(jsons), 2)
            self.assertNotEqual(wavs[0].name, wavs[1].name)

            stems = {path.stem for path in wavs}
            self.assertSetEqual(stems, {path.stem for path in txts})
            self.assertSetEqual(stems, {path.stem for path in jsons})

            for wav in wavs:
                with wave.open(str(wav), "rb") as wav_file:
                    self.assertEqual(wav_file.getframerate(), 16000)
                    self.assertEqual(wav_file.getnchannels(), 1)

    def _build_recorder(self, output_dir: Path):
        output_dir.mkdir(parents=True, exist_ok=True)
        recorder = self.daemon.WakePhraseRecorder.__new__(self.daemon.WakePhraseRecorder)
        recorder.config = SimpleNamespace(
            audio=SimpleNamespace(channels=1, sample_rate=16000, chunk_ms=80, device="default"),
            wake_phrase=SimpleNamespace(display_name="hey jarvis"),
            command_recording=SimpleNamespace(output_dir=output_dir, write_metadata=True),
            command_transcription=SimpleNamespace(
                enabled=True,
                provider="openai",
                write_text_file=True,
                openai_model="gpt-4o-mini-transcribe",
                model_path=Path("unused"),
            ),
            imp_plugin=SimpleNamespace(enabled=False),
            conversation=SimpleNamespace(enabled=False, follow_up_timeout_seconds=5.0),
            speaker_feedback=SimpleNamespace(enabled=False),
        )
        recorder.state = "recording_command"
        recorder.command_chunks = [b"\x00\x00" * 1600]
        recorder.command_chunk_count = 1
        recorder.command_start_ts = 1700000000.0
        recorder.command_max_rms = 999
        recorder.command_trigger_rms = 900
        recorder.wake_result_text = "hey jarvis"
        recorder.wake_match_text = "hey_jarvis"
        recorder.saved_recordings = 0
        recorder.awaiting_follow_up = False
        recorder.once = True
        recorder.stop_requested = False
        recorder.health_writer = SimpleNamespace(write=lambda *_args, **_kwargs: None)
        recorder.transcribe_command_audio = lambda _raw: "turn on the lights"
        recorder.write_runtime_status = lambda *_args, **_kwargs: None
        recorder.play_feedback_tone = lambda *_args, **_kwargs: None
        recorder.clear_listen_ready_status = lambda *_args, **_kwargs: None
        recorder.command_pre_roll_buffer = []
        recorder.wake_pre_roll_buffer = []
        return recorder


if __name__ == "__main__":
    unittest.main()

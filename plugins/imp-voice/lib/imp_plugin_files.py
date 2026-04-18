from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.tmp")
    temp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temp_path.replace(path)


class HealthWriter:
    def __init__(self, status_file: Path | None, service: str) -> None:
        self.status_file = status_file
        self.service = service

    def write(self, status: str, **fields: Any) -> None:
        if not self.status_file:
            return

        payload = {
            "schemaVersion": 1,
            "service": self.service,
            "status": status,
            "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            **{key: value for key, value in fields.items() if value is not None},
        }
        write_json_atomic(self.status_file, payload)


class PluginInboxWriter:
    def __init__(self, inbox_dir: Path, conversation_id: str, user_id: str) -> None:
        self.inbox_dir = inbox_dir
        self.conversation_id = conversation_id
        self.user_id = user_id

    def write_event(self, recording_path: Path, transcript: str, metadata: dict[str, Any]) -> Path:
        self.inbox_dir.mkdir(parents=True, exist_ok=True)

        text_path = recording_path.with_suffix(".txt")
        metadata_path = recording_path.with_suffix(".json")
        event_id = recording_path.stem
        file_name = f"{event_id}-{time.time_ns()}.json"
        final_path = self.inbox_dir / file_name

        event_metadata = {
            **metadata,
            "source": "imp-voice",
            "recording_file": str(recording_path),
        }
        if text_path.exists():
            event_metadata["recording_text_file"] = str(text_path)
        if metadata_path.exists():
            event_metadata["recording_metadata_file"] = str(metadata_path)

        write_json_atomic(
            final_path,
            {
                "schemaVersion": 1,
                "id": event_id,
                "conversationId": self.conversation_id,
                "userId": self.user_id,
                "text": transcript,
                "receivedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "metadata": event_metadata,
            },
        )
        return final_path

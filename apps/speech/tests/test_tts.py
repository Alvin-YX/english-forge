"""POST /tts 测试。"""

from __future__ import annotations

import base64
from typing import Any

from .helpers import assert_score_envelope


def test_tts_returns_base64_audio(client: Any) -> None:
    response = client.post("/tts", json={"text": "Good morning", "voice": "default"})

    assert response.status_code == 200
    data = assert_score_envelope(response.json())

    raw = base64.b64decode(data["audio_base64"])
    assert raw == b"fake_audio_data"


def test_tts_reports_duration(client: Any) -> None:
    data = assert_score_envelope(client.post("/tts", json={"text": "hello world"}).json())

    assert data["duration"] > 0


def test_tts_duration_has_minimum(client: Any) -> None:
    """短文本时长不低于 0.1s，避免前端出现 0 时长导致播放器异常。"""

    data = assert_score_envelope(client.post("/tts", json={"text": "hi"}).json())

    assert data["duration"] >= 0.1


def test_tts_rejects_empty_text(client: Any) -> None:
    response = client.post("/tts", json={"text": "   "})

    assert response.status_code == 422

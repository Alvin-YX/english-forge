"""POST /align/phoneme 测试。"""

from __future__ import annotations

from typing import Any

from .helpers import FAKE_AUDIO_BASE64, assert_score_envelope


def test_align_returns_spans(client: Any) -> None:
    response = client.post("/align/phoneme", json={"audio_base64": FAKE_AUDIO_BASE64, "text": "hello"})

    assert response.status_code == 200
    data = assert_score_envelope(response.json())

    assert len(data["spans"]) == 1
    span = data["spans"][0]
    assert span["phone"] == "a"
    assert span["confidence"] == 0.9
    assert span["start"] == 0.0
    assert span["end"] == 0.1


def test_align_reports_duration(client: Any) -> None:
    data = assert_score_envelope(
        client.post("/align/phoneme", json={"audio_base64": FAKE_AUDIO_BASE64, "text": "hello"}).json()
    )

    assert data["duration"] == 0.1


def test_align_handles_unparseable_audio_gracefully(client: Any) -> None:
    """无法按 float32 解析的 base64 不应导致 500，而是退化为零波形。"""

    import base64

    garbage = base64.b64encode(b"\xff" * 20).decode("ascii")
    response = client.post("/align/phoneme", json={"audio_base64": garbage, "text": "hello"})

    assert response.status_code == 200
    assert "spans" in assert_score_envelope(response.json())


def test_align_rejects_missing_text(client: Any) -> None:
    response = client.post("/align/phoneme", json={"audio_base64": FAKE_AUDIO_BASE64})

    assert response.status_code == 422

"""POST /score/shadow 测试：注入 FakeScorer + FakeAligner。"""

from __future__ import annotations

from typing import Any

from .helpers import FAKE_AUDIO_BASE64, assert_score_envelope

PAYLOAD = {
    "audio_base64": FAKE_AUDIO_BASE64,
    "target_text": "Good morning everyone",
    "user_id": "u-001",
}


def test_score_shadow_returns_weighted_metrics(client: Any) -> None:
    response = client.post("/score/shadow", json=PAYLOAD)

    assert response.status_code == 200
    data = assert_score_envelope(response.json())

    assert data["accuracy"] == 85.0
    assert data["fluency"] == 80.0
    assert data["completeness"] == 75.0
    assert data["prosody"] == 90.0
    # §5.4 L1 单词级权重：准确度 0.80 + 流利度 0.20（完整度/韵律在 L1 不适用）
    # 85*0.80 + 80*0.20 = 84.0
    assert data["overall"] == 84.0


def test_score_shadow_reports_confidence_and_grade(client: Any) -> None:
    data = assert_score_envelope(client.post("/score/shadow", json=PAYLOAD).json())

    assert data["confidence"] == 0.9
    assert data["confidence_level"] == "high"
    # high + 无噪声 => 等级 A
    assert data["grade"] == "A"
    assert data["has_noise"] is False


def test_score_shadow_includes_alignment_metadata(client: Any) -> None:
    """aligner 被调用，结果用于填充时长与 span 数。"""

    data = assert_score_envelope(client.post("/score/shadow", json=PAYLOAD).json())

    assert data["duration"] == 0.1
    assert data["span_count"] == 1


def test_score_shadow_rejects_missing_user_id(client: Any) -> None:
    response = client.post("/score/shadow", json={"audio_base64": FAKE_AUDIO_BASE64, "target_text": "hi"})

    assert response.status_code == 422


def test_score_shadow_rejects_empty_audio(client: Any) -> None:
    response = client.post("/score/shadow", json={"audio_base64": "   ", "target_text": "hi", "user_id": "u"})

    assert response.status_code == 422

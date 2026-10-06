"""POST /score/spell 测试。"""

from __future__ import annotations

from typing import Any

from .helpers import assert_score_envelope


def test_spell_correct_exact_match(client: Any) -> None:
    response = client.post("/score/spell", json={"word": "apple", "answer": "apple", "user_id": "u-1"})

    assert response.status_code == 200
    data = assert_score_envelope(response.json())

    assert data["is_correct"] is True
    assert data["confidence"] == 1.0
    assert data["confidence_level"] == "high"


def test_spell_correct_is_case_insensitive(client: Any) -> None:
    data = assert_score_envelope(
        client.post("/score/spell", json={"word": "Apple", "answer": "apple", "user_id": "u-1"}).json()
    )

    assert data["is_correct"] is True
    assert data["confidence"] == 1.0


def test_spell_completely_different_is_high_confidence_wrong(client: Any) -> None:
    """答案与目标完全无关时，系统对「判错」的结论高度确信。"""

    data = assert_score_envelope(
        client.post("/score/spell", json={"word": "apple", "answer": "xyz", "user_id": "u-1"}).json()
    )

    assert data["is_correct"] is False
    assert data["confidence"] == 1.0
    assert data["confidence_level"] == "high"


def test_spell_near_miss_is_low_confidence(client: Any) -> None:
    """只差一个字母时，系统不确定是否只是笔误，故置信度较低。"""

    data = assert_score_envelope(
        client.post("/score/spell", json={"word": "apple", "answer": "pple", "user_id": "u-1"}).json()
    )

    assert data["is_correct"] is False
    assert data["confidence"] < 0.5
    assert data["confidence_level"] == "low"


def test_spell_rejects_empty_answer(client: Any) -> None:
    response = client.post("/score/spell", json={"word": "apple", "answer": "  ", "user_id": "u-1"})

    assert response.status_code == 422

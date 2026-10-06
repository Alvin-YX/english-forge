"""POST /explain 测试。"""

from __future__ import annotations

from typing import Any

from .helpers import assert_ai_envelope


def test_explain_degrades_gracefully_with_fake_llm(client: Any) -> None:
    response = client.post("/explain", json={"word": "apple", "user_level": "beginner"})

    assert response.status_code == 200
    data = assert_ai_envelope(response.json())

    assert data["word"] == "apple"
    assert data["degraded"] is True
    assert data["examples"] == []


def test_explain_parses_json_response(scripted_client: Any, explain_script: str) -> None:
    client = scripted_client(explain_script)
    data = assert_ai_envelope(
        client.post("/explain", json={"word": "apple", "user_level": "beginner"}).json()
    )

    assert data["word"] == "apple"
    assert data["phonetic"] == "/ˈæpl/"
    assert data["meaning_cn"] == "苹果"
    assert data["part_of_speech"] == "n."
    assert data["examples"] == ["An apple a day keeps the doctor away."]
    assert data["memory_tip"]
    assert data["degraded"] is False


def test_explain_accepts_all_levels(scripted_client: Any, explain_script: str) -> None:
    """四个学段等级均应被接受，且水平会传入提示词。"""

    client = scripted_client(explain_script)
    for level in ("beginner", "elementary", "intermediate", "advanced"):
        response = client.post("/explain", json={"word": "apple", "user_level": level})
        assert response.status_code == 200
        assert assert_ai_envelope(response.json())["degraded"] is False


def test_explain_rejects_unknown_level(client: Any) -> None:
    response = client.post("/explain", json={"word": "apple", "user_level": "godlike"})

    assert response.status_code == 422


def test_explain_rejects_empty_word(client: Any) -> None:
    assert client.post("/explain", json={"word": "  ", "user_level": "beginner"}).status_code == 422

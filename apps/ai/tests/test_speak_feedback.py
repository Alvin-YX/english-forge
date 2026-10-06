"""POST /speak-practice 与 /conversation-generate 测试。"""

from __future__ import annotations

from typing import Any

from .helpers import assert_ai_envelope


def test_speak_practice_degrades_with_fake_llm(client: Any) -> None:
    response = client.post("/speak-practice", json={"text": "I go school yesterday", "level": "beginner"})

    assert response.status_code == 200
    data = assert_ai_envelope(response.json())

    assert data["degraded"] is True
    assert data["strengths"] == []
    assert data["corrections"] == []


def test_speak_practice_parses_json_response(scripted_client: Any, speak_script: str) -> None:
    client = scripted_client(speak_script)
    data = assert_ai_envelope(
        client.post("/speak-practice", json={"text": "I go school yesterday", "level": "beginner"}).json()
    )

    assert data["degraded"] is False
    assert data["summary"]
    assert data["suggestion"]
    assert len(data["corrections"]) == 1
    correction = data["corrections"][0]
    assert correction["original"] == "I go school yesterday"
    assert correction["suggested"] == "I went to school yesterday"
    assert correction["reason"]


def test_speak_practice_ignores_malformed_corrections(scripted_client: Any) -> None:
    """corrections 中出现非对象元素时应被跳过，而不是抛异常。"""

    client = scripted_client('{"summary": "ok", "strengths": [], "corrections": ["bad", null], "suggestion": "s"}')
    data = assert_ai_envelope(
        client.post("/speak-practice", json={"text": "hi", "level": "beginner"}).json()
    )

    assert data["degraded"] is False
    assert data["corrections"] == []


def test_speak_practice_rejects_empty_text(client: Any) -> None:
    assert client.post("/speak-practice", json={"text": "  ", "level": "beginner"}).status_code == 422


def test_conversation_generate_degrades_with_fake_llm(client: Any) -> None:
    payload = {"topic": "at the restaurant", "level": "beginner", "user_id": "u-001"}
    response = client.post("/conversation-generate", json=payload)

    assert response.status_code == 200
    data = assert_ai_envelope(response.json())

    assert data["degraded"] is True
    assert data["topic"] == "at the restaurant"
    assert data["level"] == "beginner"
    assert data["turns"] == []


def test_conversation_generate_parses_json_response(
    scripted_client: Any, conversation_script: str
) -> None:
    client = scripted_client(conversation_script)
    payload = {"topic": "at the restaurant", "level": "beginner", "user_id": "u-001"}
    data = assert_ai_envelope(client.post("/conversation-generate", json=payload).json())

    assert data["degraded"] is False
    assert len(data["turns"]) == 3
    assert data["turns"][0]["role"] == "assistant"
    assert data["turns"][1]["role"] == "user"


def test_conversation_generate_filters_invalid_turns(scripted_client: Any) -> None:
    """缺少 role/text 的畸形 turn 应被安全跳过。"""

    client = scripted_client('{"topic": "t", "level": "beginner", "turns": [1, null, "x"]}')
    data = assert_ai_envelope(
        client.post(
            "/conversation-generate",
            json={"topic": "t", "level": "beginner", "user_id": "u-1"},
        ).json()
    )

    assert data["degraded"] is False
    assert data["turns"] == []


def test_conversation_generate_rejects_missing_user_id(client: Any) -> None:
    response = client.post("/conversation-generate", json={"topic": "t", "level": "beginner"})

    assert response.status_code == 422

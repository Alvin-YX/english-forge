"""POST /chat 测试。"""

from __future__ import annotations

from typing import Any

from .helpers import assert_ai_envelope

CHAT_PAYLOAD = {
    "messages": [{"role": "user", "content": "What does 'apple' mean?"}],
    "user_id": "u-001",
}


def test_chat_returns_text_with_fake_llm(client: Any) -> None:
    response = client.post("/chat", json=CHAT_PAYLOAD)

    assert response.status_code == 200
    data = assert_ai_envelope(response.json())

    assert data["message"] == "Fake AI response"
    assert data["degraded"] is False
    assert data["confidence"] == 0.95


def test_chat_passes_history_and_context(client: Any) -> None:
    payload = {
        "messages": [
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello!"},
            {"role": "user", "content": "Thank you"},
        ],
        "context": "Learner is in grade 3",
        "user_id": "u-001",
    }

    response = client.post("/chat", json=payload)

    assert response.status_code == 200
    assert "message" in assert_ai_envelope(response.json())


def test_chat_rejects_empty_message_content(client: Any) -> None:
    payload = {"messages": [{"role": "user", "content": "   "}], "user_id": "u-1"}

    assert client.post("/chat", json=payload).status_code == 422


def test_chat_rejects_missing_messages(client: Any) -> None:
    assert client.post("/chat", json={"user_id": "u-1"}).status_code == 422


def test_chat_rejects_invalid_role(client: Any) -> None:
    payload = {"messages": [{"role": "hacker", "content": "hi"}], "user_id": "u-1"}

    assert client.post("/chat", json=payload).status_code == 422

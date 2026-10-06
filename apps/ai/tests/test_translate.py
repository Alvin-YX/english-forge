"""POST /translate 测试。"""

from __future__ import annotations

from typing import Any

from .helpers import assert_ai_envelope


def test_translate_degrades_gracefully_with_fake_llm(client: Any) -> None:
    """FakeLLM 输出非 JSON，端点应降级返回 200 而非 500。"""

    response = client.post("/translate", json={"text": "hello", "target_lang": "zh-CN"})

    assert response.status_code == 200
    data = assert_ai_envelope(response.json())

    assert data["source"] == "hello"
    assert data["translated"] == ""
    assert data["notes"] == []
    assert data["degraded"] is True


def test_translate_parses_json_response(scripted_client: Any, translate_script: str) -> None:
    client = scripted_client(translate_script)
    data = assert_ai_envelope(client.post("/translate", json={"text": "hello"}).json())

    assert data["source"] == "hello"
    assert data["translated"] == "你好"
    assert data["notes"] == ["口语常用问候"]
    assert data["degraded"] is False


def test_translate_tolerates_markdown_fences(scripted_client: Any) -> None:
    """模型常见的 ```json 围栏不应导致解析失败。"""

    client = scripted_client("```json\n" + '{"source": "a", "translated": "乙", "notes": []}\n```')
    data = assert_ai_envelope(client.post("/translate", json={"text": "a"}).json())

    assert data["translated"] == "乙"
    assert data["degraded"] is False


def test_translate_uses_user_text_when_model_omits_source(scripted_client: Any) -> None:
    """模型漏填 source 字段时应回退到用户原文，translated 留空且不标记降级。"""

    client = scripted_client('{"translated": ""}')
    data = assert_ai_envelope(client.post("/translate", json={"text": "keep me"}).json())

    assert data["source"] == "keep me"
    assert data["translated"] == ""
    assert data["degraded"] is False


def test_translate_rejects_empty_text(client: Any) -> None:
    assert client.post("/translate", json={"text": "   ", "target_lang": "zh-CN"}).status_code == 422

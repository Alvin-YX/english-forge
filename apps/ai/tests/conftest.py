"""共享测试 fixtures。

默认使用 :class:`FakeLLM`，保证测试不产生任何外部网络调用。
需要验证结构化输出的用例通过 :func:`scripted_router` 注入脚本化响应。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from ai import main as ai_main
from ai.llm_adapter import FakeLLM, LLMAdapter
from ai.main import create_app
from ai.router import Router


class ScriptedLLM:
    """按预设内容返回的假实现，用于验证 JSON 解析与字段映射路径。"""

    def __init__(self, content: str) -> None:
        self._content = content

    def complete(self, messages: list[dict[str, str]], **kwargs: Any) -> str:
        return self._content


@pytest.fixture()
def app() -> Any:
    """使用 FakeLLM 的应用实例；每个用例独立，依赖覆盖互不串扰。"""

    application = create_app()
    application.dependency_overrides[ai_main.get_router] = lambda: Router(FakeLLM())
    return application


@pytest.fixture()
def client(app: Any) -> Any:
    from fastapi.testclient import TestClient

    return TestClient(app)


@pytest.fixture()
def scripted_client() -> Callable[[str], Any]:
    """构造注入脚本化 LLM 响应的 TestClient，用于覆盖结构化端点 happy path。"""

    from fastapi.testclient import TestClient

    def _make(script: str) -> Any:
        application = create_app()
        application.dependency_overrides[ai_main.get_router] = lambda: Router(ScriptedLLM(script))
        return TestClient(application)

    return _make


@pytest.fixture()
def explain_script() -> str:
    """单词讲解端点的合法 JSON 响应样例。"""

    return (
        '{\n'
        '  "word": "apple",\n'
        '  "phonetic": "/ˈæpl/",\n'
        '  "meaning_cn": "苹果",\n'
        '  "part_of_speech": "n.",\n'
        '  "examples": ["An apple a day keeps the doctor away."],\n'
        '  "memory_tip": "apple 的发音像「爱拼」，苹果要爱拼才会赢。"\n'
        '}'
    )


@pytest.fixture()
def translate_script() -> str:
    """翻译端点的合法 JSON 响应样例。"""

    return '{"source": "hello", "translated": "你好", "notes": ["口语常用问候"]}'


@pytest.fixture()
def speak_script() -> str:
    """口语陪练端点的合法 JSON 响应样例。"""

    return (
        '{\n'
        '  "summary": "表达清楚，个别时态需修正。",\n'
        '  "strengths": ["语速自然"],\n'
        '  "corrections": [\n'
        '    {"original": "I go school yesterday", "suggested": "I went to school yesterday", '
        '"reason": "过去式需变 went 并补介词 to"}\n'
        '  ],\n'
        '  "suggestion": "再朗读一遍并使用 went to school 造句。"\n'
        '}'
    )


@pytest.fixture()
def conversation_script() -> str:
    """情景对话端点的合法 JSON 响应样例。"""

    return (
        '{\n'
        '  "topic": "at the restaurant",\n'
        '  "level": "beginner",\n'
        '  "turns": [\n'
        '    {"role": "assistant", "text": "Good morning, what would you like?"},\n'
        '    {"role": "user", "text": "I would like a coffee, please."},\n'
        '    {"role": "assistant", "text": "Anything else?"}\n'
        '  ]\n'
        '}'
    )


@pytest.fixture()
def failing_llm() -> LLMAdapter:
    """模拟调用失败的实现，用于验证降级路径不会返回 500。"""

    from ai.llm_adapter import LLMError

    class _Failing:
        def complete(self, messages: list[dict[str, str]], **kwargs: Any) -> str:
            raise LLMError("simulated outage")

    return _Failing()


@pytest.fixture()
def failing_client(failing_llm: LLMAdapter) -> Any:
    """注入失败 LLM 的 TestClient。"""

    from fastapi.testclient import TestClient

    application = create_app()
    application.dependency_overrides[ai_main.get_router] = lambda: Router(failing_llm)
    return TestClient(application)

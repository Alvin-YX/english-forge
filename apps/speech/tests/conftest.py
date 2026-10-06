"""共享测试 fixtures。

所有 fixture 使用 Fake 实现，保证测试不依赖任何真实音频/AI 资源。
"""

from __future__ import annotations

from typing import Any

import pytest

from speech import main as speech_main
from speech.main import create_app
from speech.scorer import FakeScorer


@pytest.fixture()
def app() -> Any:
    """每个测试用例独立的应用实例，依赖覆盖互不串扰。"""

    application = create_app()
    application.dependency_overrides[speech_main.get_scorer] = lambda: FakeScorer()
    return application


@pytest.fixture()
def client(app: Any) -> Any:
    from fastapi.testclient import TestClient

    return TestClient(app)

"""AI 服务测试共享常量与断言辅助。"""

from __future__ import annotations

from typing import Any


def assert_ai_envelope(body: dict[str, Any]) -> dict[str, Any]:
    """校验统一信封结构并返回 data 部分。"""

    assert body["code"] == 0
    assert body["message"] == "ok"
    assert isinstance(body["data"], dict)
    return body["data"]

"""GET /healthz 测试。"""

from __future__ import annotations

from typing import Any


def test_healthz_returns_ok(client: Any) -> None:
    response = client.get("/healthz")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "ai"
    assert body["version"] == "1.0.0"


def test_healthz_is_not_wrapped_in_envelope(client: Any) -> None:
    """健康检查为平台探活端点，返回裸对象而非业务信封。"""

    body = client.get("/healthz").json()
    assert "data" not in body
    assert "code" not in body

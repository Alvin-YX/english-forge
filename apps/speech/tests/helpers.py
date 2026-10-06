"""测试共享常量与断言辅助。"""

from __future__ import annotations

import base64
from typing import Any

#: 固定的假音频 base64（内容语义无关，Fake 实现不解析音频）。
FAKE_AUDIO_BASE64 = base64.b64encode(b"0.1" * 64).decode("ascii")

#: FakeScorer 固定指标下的加权综合分：85*0.35 + 80*0.25 + 75*0.20 + 90*0.20 = 82.75
EXPECTED_OVERALL = 82.75


def assert_score_envelope(body: dict[str, Any]) -> dict[str, Any]:
    """校验统一信封结构并返回 data 部分。"""

    assert body["code"] == 0
    assert body["message"] == "ok"
    assert isinstance(body["data"], dict)
    return body["data"]

"""音素对齐器的 Protocol 抽象与 Fake 实现。"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np

from .models import PhoneSpan


@runtime_checkable
class PhonemeAligner(Protocol):
    """音素对齐协议。

    :param wav: 原始波形（单声道，float32）。
    :param text: 文本内容。
    """

    def align(self, wav: np.ndarray, text: str) -> list[PhoneSpan]: ...


class FakeAligner:
    """测试用假对齐器：返回一个固定 span，保证下游序列化路径被覆盖。"""

    def align(self, wav: np.ndarray, text: str) -> list[PhoneSpan]:
        return [PhoneSpan(phone="a", confidence=0.9, start=0.0, end=0.1)]

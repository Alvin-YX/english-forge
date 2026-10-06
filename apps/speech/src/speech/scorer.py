"""跟读评分引擎的 Protocol 抽象与 Fake 实现。

依赖倒置（DIP）：``main.py`` 只依赖 :class:`ScoreScorer` 协议，
不 import 任何真实声学模型。单元测试注入 :class:`FakeScorer`。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import numpy as np


@dataclass(frozen=True)
class ScoreMetrics:
    """评分引擎输出的四维原始指标（百分制）。"""

    accuracy: float
    fluency: float
    completeness: float
    prosody: float
    confidence: float = 0.9
    has_noise: bool = False


@runtime_checkable
class ScoreScorer(Protocol):
    """跟读评分引擎协议。

    :param audio: 原始波形（单声道，float32，已重采样）。
    :param target_text: 应朗读的目标文本。
    """

    def score(self, audio: np.ndarray, target_text: str) -> ScoreMetrics: ...


class FakeScorer:
    """测试用假评分器：返回稳定的固定指标，不触碰真实音频。"""

    def score(self, audio: np.ndarray, target_text: str) -> ScoreMetrics:
        return ScoreMetrics(
            accuracy=85.0,
            fluency=80.0,
            completeness=75.0,
            prosody=90.0,
            confidence=0.9,
            has_noise=False,
        )

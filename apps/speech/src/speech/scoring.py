"""评分公式与置信度/降级等级计算。

纯函数模块：无 I/O、无状态，便于 golden test 精确断言。

加权公式（03 文档约定的跟读评分权重）：

    overall = accuracy * 0.35 + fluency * 0.25 + completeness * 0.20 + prosody * 0.20

置信度等级与降级等级的边界见 README 与 ``classify`` 文档字符串。
"""

from __future__ import annotations

from .models import ConfidenceLevel, Grade

#: 权重常量，总和必须为 1.0。测试断言以此为准。
WEIGHTS: dict[str, float] = {
    "accuracy": 0.35,
    "fluency": 0.25,
    "completeness": 0.20,
    "prosody": 0.20,
}

#: 置信度等级阈值：>= HIGH_THRESHOLD 为 high，>= MEDIUM_THRESHOLD 为 medium，否则 low。
HIGH_THRESHOLD: float = 0.8
MEDIUM_THRESHOLD: float = 0.5


def compute_overall(
    accuracy: float,
    fluency: float,
    completeness: float,
    prosody: float,
) -> float:
    """按固定权重计算综合分，并截断到 [0, 100]。

    各分项理论上已在 [0, 100]，但上游模型可能越界，这里做防御性截断，
    保证对外返回值始终满足 ``ScoreResult.overall`` 的约束区间。
    """

    overall = (
        accuracy * WEIGHTS["accuracy"]
        + fluency * WEIGHTS["fluency"]
        + completeness * WEIGHTS["completeness"]
        + prosody * WEIGHTS["prosody"]
    )
    return round(min(max(overall, 0.0), 100.0), 2)


def classify_confidence(confidence: float) -> ConfidenceLevel:
    """将 0-1 置信度映射为 high / medium / low。"""

    if confidence >= HIGH_THRESHOLD:
        return ConfidenceLevel.HIGH
    if confidence >= MEDIUM_THRESHOLD:
        return ConfidenceLevel.MEDIUM
    return ConfidenceLevel.LOW


def classify_grade(confidence_level: ConfidenceLevel, has_noise: bool, critical_error: bool = False) -> Grade:
    """将置信度等级 + 噪声标记映射为降级等级 A-F。

    - F: 严重错误（评分过程异常，直接返回 F）
    - A: high 且无噪声（最佳质量）
    - B: high 但有噪声
    - C: medium（任何噪声状态）
    - D: low 且有噪声
    - E: low 且无噪声
    """

    if critical_error:
        return Grade.F
    if confidence_level == ConfidenceLevel.HIGH:
        return Grade.A if not has_noise else Grade.B
    if confidence_level == ConfidenceLevel.MEDIUM:
        return Grade.C
    return Grade.D if has_noise else Grade.E

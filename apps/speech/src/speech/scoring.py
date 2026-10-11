"""评分公式与置信度/降级等级计算。

纯函数模块：无 I/O、无状态，便于 golden test 精确断言。

本模块只实现文档里**明确写出的**公式，不引入文档之外的自定权重。
以下两条均出自 `forge-out/04-英语学习软件开发文档.md`：

① 音素级评测四步链路 · 步骤④（§5.3）::

    overall = 0.3 × 声学距离 + 0.4 × (1 − 音素错误率) + 0.3 × (1 − 词错误率)
            → 裁剪到 [0, 100]

② 评分维度权重矩阵（§5.4），按练习级别 L1-L5 取用，见 ``LEVEL_WEIGHTS``。

``classify_confidence`` / ``classify_grade`` 是降级兜底逻辑，文档未规定具体
阈值，沿用现有约定（见各函数文档字符串）。
"""

from __future__ import annotations

from .models import ConfidenceLevel, Grade

# --------------------------------------------------------------------------- #
# ① §5.3 四步链路的加权总分
# --------------------------------------------------------------------------- #

#: §5.3 步骤④的固定权重。三项相加恒为 1.0。
PIPELINE_WEIGHTS: dict[str, float] = {
    "acoustic_distance": 0.3,
    "per": 0.4,
    "wer": 0.3,
}

#: §5.3 步骤③的近似音降权系数（清浊、紧松元音等近似音按 0.5 计）。
APPROXIMATE_PHONE_WEIGHT: float = 0.5


def compute_pipeline_score(
    acoustic_distance: float,
    per: float,
    wer: float,
) -> float:
    """按 §5.3 步骤④计算加权总分，裁剪到 ``[0, 100]``。

    :param acoustic_distance: 声学相似度，0-1，**越大越好**。
        原始 DTW 距离需先归一化为相似度再传入，否则公式不成立。
    :param per: 音素错误率（Phoneme Error Rate），0-1。
    :param wer: 词错误率（Word Error Rate），0-1。
    """

    acoustic = max(min(acoustic_distance, 1.0), 0.0)
    phoneme = max(min(per, 1.0), 0.0)
    word = max(min(wer, 1.0), 0.0)

    overall = 100.0 * (
        PIPELINE_WEIGHTS["acoustic_distance"] * acoustic
        + PIPELINE_WEIGHTS["per"] * (1.0 - phoneme)
        + PIPELINE_WEIGHTS["wer"] * (1.0 - word)
    )
    return round(min(max(overall, 0.0), 100.0), 2)


# --------------------------------------------------------------------------- #
# ② §5.4 评分维度权重矩阵
# --------------------------------------------------------------------------- #

#: §5.4 原文矩阵，百分比已转成小数。
#:
#: | 级别 | 准确度 | 流利度 | 完整度 | 韵律  | 语法/内容 |
#: |------|--------|--------|--------|-------|-----------|
#: | L1   | 0.80   | 0.20   | —      | —     | —         |
#: | L2   | 0.50   | 0.30   | 0.20   | —     | —         |
#: | L3   | 0.30   | 0.20   | 0.10   | 0.15  | 0.25      |
#: | L4   | 0.20   | 0.20   | 0.10   | 0.25  | 0.25      |
#: | L5   | 0.15   | 0.15   | 0.10   | 0.25  | 0.35      |
LEVEL_WEIGHTS: dict[str, dict[str, float]] = {
    "L1": {"accuracy": 0.80, "fluency": 0.20},
    "L2": {"accuracy": 0.50, "fluency": 0.30, "completeness": 0.20},
    "L3": {
        "accuracy": 0.30,
        "fluency": 0.20,
        "completeness": 0.10,
        "prosody": 0.15,
        "grammar": 0.25,
    },
    "L4": {
        "accuracy": 0.20,
        "fluency": 0.20,
        "completeness": 0.10,
        "prosody": 0.25,
        "grammar": 0.25,
    },
    "L5": {
        "accuracy": 0.15,
        "fluency": 0.15,
        "completeness": 0.10,
        "prosody": 0.25,
        "grammar": 0.35,
    },
}

#: 当前 API 契约（``ScoreResult``）实际建模的维度。
#:
#: 已知偏离 D-09：§5.4 的 L3-L5 含「语法/内容」维度，但 ``ScoreResult``
#: 只有四维。在该维度补齐前，缺失权重按比例分摊到其余维度（见
#: ``effective_weights``）。补齐后删除该分摊逻辑即可。
SCORE_DIMENSIONS: tuple[str, ...] = (
    "accuracy",
    "fluency",
    "completeness",
    "prosody",
)

#: 跟读练习以单词为单位，默认落在 L1。
DEFAULT_LEVEL: str = "L1"

#: 置信度等级阈值：>= HIGH_THRESHOLD 为 high，>= MEDIUM_THRESHOLD 为 medium。
HIGH_THRESHOLD: float = 0.8
MEDIUM_THRESHOLD: float = 0.5


def effective_weights(level: str) -> dict[str, float]:
    """取某级别下 API 实际建模维度的权重，保证总和为 1.0。

    L1/L2 的四维子集本身即覆盖文档全部权重，无需分摊；
    L3-L5 的「语法/内容」权重按比例分摊到其余维度。
    """

    raw = LEVEL_WEIGHTS.get(level, LEVEL_WEIGHTS[DEFAULT_LEVEL])
    available = {k: v for k, v in raw.items() if k in SCORE_DIMENSIONS}
    total = sum(available.values())
    if total <= 0:
        return {dim: 1.0 / len(SCORE_DIMENSIONS) for dim in SCORE_DIMENSIONS}
    return {k: v / total for k, v in available.items()}


def compute_overall(
    accuracy: float,
    fluency: float,
    completeness: float,
    prosody: float,
    level: str = DEFAULT_LEVEL,
) -> float:
    """按 §5.4 的级别权重计算综合分，并截断到 ``[0, 100]``。

    各分项理论上已在 ``[0, 100]``，但上游模型可能越界，这里做防御性截断，
    保证对外返回值始终满足 ``ScoreResult.overall`` 的约束区间。

    :param level: 练习级别 ``L1``-``L5``，未知级别回退到 ``DEFAULT_LEVEL``。
    """

    scores = {
        "accuracy": accuracy,
        "fluency": fluency,
        "completeness": completeness,
        "prosody": prosody,
    }
    weights = effective_weights(level)
    overall = sum(
        max(min(scores[dim], 100.0), 0.0) * weight
        for dim, weight in weights.items()
    )
    return round(min(max(overall, 0.0), 100.0), 2)


def classify_confidence(confidence: float) -> ConfidenceLevel:
    """将 0-1 置信度映射为 high / medium / low。"""

    if confidence >= HIGH_THRESHOLD:
        return ConfidenceLevel.HIGH
    if confidence >= MEDIUM_THRESHOLD:
        return ConfidenceLevel.MEDIUM
    return ConfidenceLevel.LOW


def classify_grade(
    confidence_level: ConfidenceLevel,
    has_noise: bool,
    critical_error: bool = False,
) -> Grade:
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

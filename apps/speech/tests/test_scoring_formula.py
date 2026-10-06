"""评分公式、置信度等级与降级等级的 golden 测试。"""

from __future__ import annotations

import pytest

from speech.models import ConfidenceLevel, Grade
from speech.scoring import (
    HIGH_THRESHOLD,
    MEDIUM_THRESHOLD,
    WEIGHTS,
    classify_confidence,
    classify_grade,
    compute_overall,
)


class TestWeights:
    def test_weights_sum_to_one(self) -> None:
        assert sum(WEIGHTS.values()) == pytest.approx(1.0)

    def test_weights_match_spec(self) -> None:
        assert WEIGHTS["accuracy"] == 0.35
        assert WEIGHTS["fluency"] == 0.25
        assert WEIGHTS["completeness"] == 0.20
        assert WEIGHTS["prosody"] == 0.20


class TestComputeOverall:
    def test_perfect_scores(self) -> None:
        assert compute_overall(100, 100, 100, 100) == 100.0

    def test_zero_scores(self) -> None:
        assert compute_overall(0, 0, 0, 0) == 0.0

    def test_fake_scorer_baseline(self) -> None:
        """与 FakeScorer 固定指标一致：85/80/75/90 -> 82.75。"""

        assert compute_overall(85.0, 80.0, 75.0, 90.0) == 82.75

    def test_accuracy_dominates_weighting(self) -> None:
        """准确率权重最高（0.35），单维提升对总分影响最大。"""

        high_accuracy = compute_overall(100, 50, 50, 50)
        high_prosody = compute_overall(50, 50, 50, 100)
        assert high_accuracy > high_prosody

    def test_out_of_range_values_are_clamped(self) -> None:
        assert compute_overall(150, 150, 150, 150) == 100.0
        assert compute_overall(-10, -10, -10, -10) == 0.0

    def test_result_is_rounded_to_two_decimals(self) -> None:
        result = compute_overall(33.333333, 66.666666, 50.5, 25.25)
        assert result == round(result, 2)


class TestClassifyConfidence:
    def test_thresholds_are_documented(self) -> None:
        assert HIGH_THRESHOLD == 0.8
        assert MEDIUM_THRESHOLD == 0.5

    @pytest.mark.parametrize(
        ("confidence", "expected"),
        [
            (1.0, ConfidenceLevel.HIGH),
            (0.8, ConfidenceLevel.HIGH),  # 边界含等号
            (0.79, ConfidenceLevel.MEDIUM),
            (0.5, ConfidenceLevel.MEDIUM),  # 边界含等号
            (0.49, ConfidenceLevel.LOW),
            (0.0, ConfidenceLevel.LOW),
        ],
    )
    def test_boundaries(self, confidence: float, expected: ConfidenceLevel) -> None:
        assert classify_confidence(confidence) is expected


class TestClassifyGrade:
    def test_high_without_noise_is_grade_a(self) -> None:
        assert classify_grade(ConfidenceLevel.HIGH, has_noise=False) is Grade.A

    def test_high_with_noise_is_grade_b(self) -> None:
        assert classify_grade(ConfidenceLevel.HIGH, has_noise=True) is Grade.B

    def test_medium_is_grade_c_regardless_of_noise(self) -> None:
        assert classify_grade(ConfidenceLevel.MEDIUM, has_noise=False) is Grade.C
        assert classify_grade(ConfidenceLevel.MEDIUM, has_noise=True) is Grade.C

    def test_low_with_noise_is_grade_d(self) -> None:
        assert classify_grade(ConfidenceLevel.LOW, has_noise=True) is Grade.D

    def test_low_without_noise_is_grade_e(self) -> None:
        assert classify_grade(ConfidenceLevel.LOW, has_noise=False) is Grade.E

    def test_critical_error_always_is_grade_f(self) -> None:
        assert classify_grade(ConfidenceLevel.HIGH, has_noise=False, critical_error=True) is Grade.F
        assert classify_grade(ConfidenceLevel.LOW, has_noise=True, critical_error=True) is Grade.F

    def test_all_six_grades_are_reachable(self) -> None:
        """A-F 六个等级均可被真实输入触达，避免出现死代码分支。"""

        grades = {
            classify_grade(ConfidenceLevel.HIGH, has_noise=False),
            classify_grade(ConfidenceLevel.HIGH, has_noise=True),
            classify_grade(ConfidenceLevel.MEDIUM, has_noise=False),
            classify_grade(ConfidenceLevel.LOW, has_noise=True),
            classify_grade(ConfidenceLevel.LOW, has_noise=False),
            classify_grade(ConfidenceLevel.HIGH, has_noise=False, critical_error=True),
        }
        assert grades == set(Grade)

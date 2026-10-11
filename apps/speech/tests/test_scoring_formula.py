"""评分公式、置信度等级与降级等级的 golden 测试。

公式数值全部来自 `forge-out/04-英语学习软件开发文档.md`：
§5.3 步骤④（四步链路加权总分）与 §5.4（评分维度与权重矩阵）。
改动文档里的权重数字时必须同步改这里的断言。
"""

from __future__ import annotations

import pytest

from speech.models import ConfidenceLevel, Grade
from speech.scoring import (
    APPROXIMATE_PHONE_WEIGHT,
    DEFAULT_LEVEL,
    HIGH_THRESHOLD,
    LEVEL_WEIGHTS,
    MEDIUM_THRESHOLD,
    PIPELINE_WEIGHTS,
    SCORE_DIMENSIONS,
    classify_confidence,
    classify_grade,
    compute_overall,
    compute_pipeline_score,
    effective_weights,
)


# --------------------------------------------------------------------------- #
# §5.3 步骤④：0.3×声学距离 + 0.4×(1−PER) + 0.3×(1−WER)
# --------------------------------------------------------------------------- #
class TestPipelineWeights:
    def test_weights_sum_to_one(self) -> None:
        assert sum(PIPELINE_WEIGHTS.values()) == pytest.approx(1.0)

    def test_weights_match_spec(self) -> None:
        """与文档 §5.3 步骤④、§5.3 步骤③的近似音系数逐字对齐。"""

        assert PIPELINE_WEIGHTS["acoustic_distance"] == pytest.approx(0.3)
        assert PIPELINE_WEIGHTS["per"] == pytest.approx(0.4)
        assert PIPELINE_WEIGHTS["wer"] == pytest.approx(0.3)
        assert pytest.approx(0.5) == APPROXIMATE_PHONE_WEIGHT


class TestPipelineScore:
    def test_perfect_acoustics_and_no_errors(self) -> None:
        assert compute_pipeline_score(1.0, 0.0, 0.0) == 100.0

    def test_total_failure(self) -> None:
        assert compute_pipeline_score(0.0, 1.0, 1.0) == 0.0

    def test_uniform_midpoints_are_50(self) -> None:
        """三项都处于中点时总分恰为 50，验证三项权重之和为 1.0。"""

        assert compute_pipeline_score(0.5, 0.5, 0.5) == 50.0

    def test_phoneme_error_is_most_influential(self) -> None:
        """PER 权重最高（0.4），同等错误率下 PER 对总分拉低最多。"""

        only_per = compute_pipeline_score(1.0, 0.5, 0.0)
        only_wer = compute_pipeline_score(1.0, 0.0, 0.5)
        assert only_per < only_wer
        assert only_wer < 100.0

    def test_doc_example_child_level_wer(self) -> None:
        """文档 §5.2 指标表给出儿童 WER 约 8-15%；用 5% 作一例校验算例。"""

        assert compute_pipeline_score(1.0, 0.10, 0.05) == 94.5

    def test_inputs_clamped_to_unit_interval(self) -> None:
        """相似度/错误率越界时先裁剪到 [0,1]，等价于裁剪后的输入。"""

        assert compute_pipeline_score(2.0, -0.5, 3.0) == compute_pipeline_score(1.0, 0.0, 1.0)
        assert compute_pipeline_score(-1.0, 2.0, -1.0) == compute_pipeline_score(0.0, 1.0, 0.0)

    def test_result_is_rounded_to_two_decimals(self) -> None:
        result = compute_pipeline_score(0.333333, 0.666666, 0.2525)
        assert result == round(result, 2)


# --------------------------------------------------------------------------- #
# §5.4 评分维度与权重矩阵
# --------------------------------------------------------------------------- #
class TestLevelWeights:
    @pytest.mark.parametrize("level", ["L1", "L2", "L3", "L4", "L5"])
    def test_every_level_matrix_sums_to_one(self, level: str) -> None:
        """文档矩阵每一行的百分比相加均为 100%。"""

        assert sum(LEVEL_WEIGHTS[level].values()) == pytest.approx(1.0)

    def test_l1_word_level_matches_spec(self) -> None:
        assert LEVEL_WEIGHTS["L1"] == {"accuracy": 0.80, "fluency": 0.20}

    def test_l2_sentence_level_matches_spec(self) -> None:
        assert LEVEL_WEIGHTS["L2"] == {
            "accuracy": 0.50,
            "fluency": 0.30,
            "completeness": 0.20,
        }

    def test_l3_scenario_level_matches_spec(self) -> None:
        assert LEVEL_WEIGHTS["L3"] == {
            "accuracy": 0.30,
            "fluency": 0.20,
            "completeness": 0.10,
            "prosody": 0.15,
            "grammar": 0.25,
        }

    def test_l4_free_level_matches_spec(self) -> None:
        assert LEVEL_WEIGHTS["L4"] == {
            "accuracy": 0.20,
            "fluency": 0.20,
            "completeness": 0.10,
            "prosody": 0.25,
            "grammar": 0.25,
        }

    def test_l5_presentation_level_matches_spec(self) -> None:
        assert LEVEL_WEIGHTS["L5"] == {
            "accuracy": 0.15,
            "fluency": 0.15,
            "completeness": 0.10,
            "prosody": 0.25,
            "grammar": 0.35,
        }

    def test_score_dimensions_excludes_grammar(self) -> None:
        """D-09：ScoreResult 尚未建模「语法/内容」维度。"""

        assert SCORE_DIMENSIONS == ("accuracy", "fluency", "completeness", "prosody")
        assert "grammar" not in SCORE_DIMENSIONS


class TestEffectiveWeights:
    @pytest.mark.parametrize("level", ["L1", "L2", "L3", "L4", "L5"])
    def test_effective_weights_sum_to_one(self, level: str) -> None:
        assert sum(effective_weights(level).values()) == pytest.approx(1.0)

    def test_l1_needs_no_redistribution(self) -> None:
        assert effective_weights("L1") == {"accuracy": 0.80, "fluency": 0.20}

    def test_l2_needs_no_redistribution(self) -> None:
        assert effective_weights("L2") == {
            "accuracy": 0.50,
            "fluency": 0.30,
            "completeness": 0.20,
        }

    def test_l3_grammar_weight_is_redistributed(self) -> None:
        """L3 的 grammar 0.25 剔除后，其余四项按 0.75 归一化。"""

        weights = effective_weights("L3")
        assert "grammar" not in weights
        assert weights["accuracy"] == pytest.approx(0.30 / 0.75)
        assert weights["fluency"] == pytest.approx(0.20 / 0.75)
        assert weights["completeness"] == pytest.approx(0.10 / 0.75)
        assert weights["prosody"] == pytest.approx(0.15 / 0.75)

    def test_l5_grammar_weight_is_redistributed(self) -> None:
        """L5 的 grammar 0.35 占比最大，分摊后韵律相对权重反而最高。"""

        weights = effective_weights("L5")
        assert weights["prosody"] > weights["accuracy"]
        assert weights["accuracy"] == pytest.approx(0.15 / 0.65)

    def test_unknown_level_falls_back_to_default(self) -> None:
        assert effective_weights("L9") == effective_weights(DEFAULT_LEVEL)
        assert DEFAULT_LEVEL == "L1"


class TestComputeOverall:
    @pytest.mark.parametrize("level", ["L1", "L2", "L3", "L4", "L5"])
    def test_perfect_scores_are_100(self, level: str) -> None:
        assert compute_overall(100, 100, 100, 100, level) == 100.0

    @pytest.mark.parametrize("level", ["L1", "L2", "L3", "L4", "L5"])
    def test_zero_scores_are_0(self, level: str) -> None:
        assert compute_overall(0, 0, 0, 0, level) == 0.0

    def test_l1_accuracy_dominates(self) -> None:
        """L1 准确度权重 0.80，远高于流利度 0.20。"""

        high_accuracy = compute_overall(100, 50, 50, 50, "L1")
        high_fluency = compute_overall(50, 100, 50, 50, "L1")
        assert high_accuracy > high_fluency
        assert high_accuracy == 90.0  # 100*0.8 + 50*0.2
        assert high_fluency == 60.0  # 50*0.8 + 100*0.2

    def test_l5_prosody_dominates(self) -> None:
        """L5 演讲级韵律权重最高（分摊后 0.385），准确度权重最低。"""

        high_prosody = compute_overall(50, 50, 50, 100, "L5")
        high_accuracy = compute_overall(100, 50, 50, 50, "L5")
        assert high_prosody > high_accuracy

    def test_level_changes_the_same_inputs(self) -> None:
        """同一组四维分数在不同级别下总分不同 —— 权重矩阵确实生效。"""

        totals = [compute_overall(85, 80, 75, 90, lvl) for lvl in ["L1", "L2", "L3", "L5"]]
        assert len(set(totals)) > 1

    def test_default_level_is_l1(self) -> None:
        assert compute_overall(85, 80, 75, 90) == compute_overall(85, 80, 75, 90, DEFAULT_LEVEL)

    def test_out_of_range_values_are_clamped(self) -> None:
        assert compute_overall(150, 150, 150, 150, "L3") == 100.0
        assert compute_overall(-10, -10, -10, -10, "L3") == 0.0

    def test_result_is_rounded_to_two_decimals(self) -> None:
        result = compute_overall(33.333333, 66.666666, 50.5, 25.25, "L4")
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

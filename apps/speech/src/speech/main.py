"""EnglishForge speech service —— FastAPI 应用入口。

启动：``uvicorn speech.main:app --reload``

依赖注入约定（DIP）：评分引擎、对齐器、TTS 引擎全部以 ``typing.Protocol`` 抽象，
路由只依赖协议，不 import 具体实现。默认 Provider 返回 Fake 实现，因此
测试与本地开发无需任何真实音频模型即可跑通全链路；生产部署时通过
``app.dependency_overrides`` 或环境变量接入真实引擎。
"""

from __future__ import annotations

import base64
import os

import numpy as np
from fastapi import Depends, FastAPI

from .aligner import FakeAligner, PhonemeAligner
from .models import (
    AlignInput,
    AlignResult,
    ApiResponse,
    ConfidenceLevel,
    ScoreInput,
    ScoreResult,
    SpellInput,
    SpellResult,
    TTSInput,
    TTSResult,
)
from .scorer import FakeScorer, ScoreScorer
from .scoring import classify_confidence, classify_grade, compute_overall
from .tts import FakeTTS, TTSEngine

SERVICE_NAME = "speech"
SERVICE_VERSION = "1.0.0"


def _use_fake() -> bool:
    """读取 ``SPEECH_USE_FAKE``：默认 true，便于测试与本地开发零依赖启动。"""

    return os.getenv("SPEECH_USE_FAKE", "true").strip().lower() not in {"0", "false", "no", "off"}


# --------------------------------------------------------------------------- #
# Provider（可被 app.dependency_overrides 覆盖）
# --------------------------------------------------------------------------- #
def get_scorer() -> ScoreScorer:
    if _use_fake():
        return FakeScorer()
    raise RuntimeError("未配置真实评分引擎：请通过 app.dependency_overrides['get_scorer'] 注入")


def get_aligner() -> PhonemeAligner:
    if _use_fake():
        return FakeAligner()
    raise RuntimeError("未配置真实对齐器：请通过 app.dependency_overrides['get_aligner'] 注入")


def get_tts_engine() -> TTSEngine:
    if _use_fake():
        return FakeTTS()
    raise RuntimeError("未配置真实 TTS 引擎：请通过 app.dependency_overrides['get_tts_engine'] 注入")


# --------------------------------------------------------------------------- #
# 工具函数
# --------------------------------------------------------------------------- #
def decode_audio_base64(audio_base64: str) -> np.ndarray:
    """将 base64 音频解码为 float32 单声道波形。

    容错策略：能按 float32 解析则原样使用，否则退化为等长的零波形。
    该函数**不校验音频语义**，只保证下游拿到形状合理的数组。
    """

    raw = base64.b64decode(audio_base64, validate=False) if audio_base64.strip() else b""
    if len(raw) >= 4 and len(raw) % 4 == 0:
        try:
            return np.frombuffer(raw, dtype=np.float32).copy()
        except ValueError:
            pass
    return np.zeros(max(len(raw) // 4, 1), dtype=np.float32)


def _spell_similarity(word: str, answer: str) -> float:
    """基于 difflib 的拼写相似度（0-1），供置信度使用。"""

    from difflib import SequenceMatcher

    return SequenceMatcher(None, word.lower(), answer.lower()).ratio()


# --------------------------------------------------------------------------- #
# 应用工厂
# --------------------------------------------------------------------------- #
def create_app() -> FastAPI:
    """构建 FastAPI 应用。使用工厂便于测试中重复创建实例。"""

    app = FastAPI(
        title="EnglishForge Speech Service",
        version=SERVICE_VERSION,
        description="跟读评分 / 音素对齐 / 拼写判定 / TTS",
    )

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok", "service": SERVICE_NAME, "version": SERVICE_VERSION}

    @app.post("/score/shadow", response_model=ApiResponse)
    def score_shadow(
        payload: ScoreInput,
        scorer: ScoreScorer = Depends(get_scorer),
        aligner: PhonemeAligner = Depends(get_aligner),
    ) -> ApiResponse:
        """跟读评分：scorer 产出四维指标，aligner 产出音素时序用于时长/覆盖率统计。"""

        audio = decode_audio_base64(payload.audio_base64)
        metrics = scorer.score(audio, payload.target_text)
        spans = aligner.align(audio, payload.target_text)

        duration = float(max((s.end for s in spans), default=0.0))
        confidence_level = classify_confidence(metrics.confidence)

        result = ScoreResult(
            accuracy=metrics.accuracy,
            fluency=metrics.fluency,
            completeness=metrics.completeness,
            prosody=metrics.prosody,
            overall=compute_overall(metrics.accuracy, metrics.fluency, metrics.completeness, metrics.prosody),
            confidence=metrics.confidence,
            confidence_level=confidence_level,
            grade=classify_grade(confidence_level, metrics.has_noise),
            has_noise=metrics.has_noise,
            duration=duration,
            span_count=len(spans),
        )
        return ApiResponse(code=0, message="ok", data=result.model_dump(mode="json"))

    @app.post("/score/spell", response_model=ApiResponse)
    def score_spell(payload: SpellInput) -> ApiResponse:
        """拼写判定：大小写不敏感精确匹配即为正确。

        ``word``/``answer`` 已由 ``SpellInput`` 的校验器去除首尾空白。
        """

        is_correct = payload.word.lower() == payload.answer.lower()
        if is_correct:
            confidence = 1.0
        else:
            # 置信度表示「对判定结果的确信程度」：差异越大越确信拼写错误，
            # 差异越接近正确答案则越不确定（可能是笔误）。
            similarity = _spell_similarity(payload.word, payload.answer)
            confidence = round(max(1.0 - similarity, 0.0), 3)

        result = SpellResult(
            is_correct=is_correct,
            confidence=confidence,
            confidence_level=classify_confidence(confidence),
        )
        return ApiResponse(code=0, message="ok", data=result.model_dump(mode="json"))

    @app.post("/align/phoneme", response_model=ApiResponse)
    def align_phoneme(
        payload: AlignInput,
        aligner: PhonemeAligner = Depends(get_aligner),
    ) -> ApiResponse:
        """音素对齐：返回音素 span 列表与音频总时长。"""

        wav = decode_audio_base64(payload.audio_base64)
        spans = aligner.align(wav, payload.text)
        result = AlignResult(
            spans=spans,
            duration=float(max((s.end for s in spans), default=0.0)),
        )
        return ApiResponse(code=0, message="ok", data=result.model_dump(mode="json"))

    @app.post("/tts", response_model=ApiResponse)
    def synthesize(
        payload: TTSInput,
        engine: TTSEngine = Depends(get_tts_engine),
    ) -> ApiResponse:
        """文本转语音：返回 base64 音频与估算时长（0.05s/字符，最低 0.1s）。"""

        audio_bytes = engine.synthesize(payload.text, payload.voice)
        duration = max(0.1, round(len(payload.text) * 0.05, 3))
        result = TTSResult(
            audio_base64=base64.b64encode(audio_bytes).decode("ascii"),
            duration=duration,
        )
        return ApiResponse(code=0, message="ok", data=result.model_dump(mode="json"))

    return app


app = create_app()


def get_app() -> FastAPI:
    """返回模块级 app，便于 ``uvicorn speech.main:app`` 与测试共用。"""

    return app


__all__ = [
    "AlignInput",
    "AlignResult",
    "ApiResponse",
    "ConfidenceLevel",
    "ScoreInput",
    "ScoreResult",
    "SpellInput",
    "SpellResult",
    "TTSInput",
    "TTSResult",
    "app",
    "create_app",
]

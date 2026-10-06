"""Pydantic v2 request/response models for the speech service."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class ConfidenceLevel(StrEnum):
    """置信度等级，用于前端区分展示强度与是否降级展示。"""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Grade(StrEnum):
    """降级等级 A-F：A 最优，F 表示严重错误（无法评分）。"""

    A = "A"
    B = "B"
    C = "C"
    D = "D"
    E = "E"
    F = "F"


class ApiResponse(BaseModel):
    """统一响应信封，与 NestJS API 侧 `{code, message, data}` 对齐。"""

    code: int = 0
    message: str = "ok"
    data: Any = None


def _require_non_blank(value: str) -> str:
    """拒绝仅由空白字符组成的输入。

    Pydantic 的 ``min_length`` 把空白字符也计入长度，无法拦截 ``"   "``，
    因此这里统一做 strip 后判空，并返回 strip 后的值以保持下游一致。
    """

    trimmed = value.strip()
    if not trimmed:
        raise ValueError("字段不能为空或仅包含空白字符")
    return trimmed


# --------------------------------------------------------------------------- #
# 跟读评分
# --------------------------------------------------------------------------- #
class ScoreInput(BaseModel):
    """跟读评分请求：音频 base64 + 目标文本 + 用户标识。"""

    audio_base64: str = Field(..., min_length=1, description="base64 编码的音频数据")
    target_text: str = Field(..., min_length=1, description="应朗读的目标文本")
    user_id: str = Field(..., min_length=1, description="用户 ID")

    _strip_fields = field_validator("audio_base64", "target_text", "user_id")(_require_non_blank)


class ScoreResult(BaseModel):
    """跟读评分结果：五维分数 + 综合分 + 置信度与降级等级。"""

    accuracy: float = Field(..., ge=0, le=100, description="准确度")
    fluency: float = Field(..., ge=0, le=100, description="流利度")
    completeness: float = Field(..., ge=0, le=100, description="完整度")
    prosody: float = Field(..., ge=0, le=100, description="韵律度")
    overall: float = Field(..., ge=0, le=100, description="加权综合分")
    confidence: float = Field(..., ge=0, le=1, description="0-1 置信度")
    confidence_level: ConfidenceLevel
    grade: Grade = Field(..., description="降级等级 A-F")
    has_noise: bool = False
    duration: float = Field(0.0, ge=0, description="对齐得到的音频时长（秒）")
    span_count: int = Field(0, ge=0, description="对齐得到的音素 span 数量")


# --------------------------------------------------------------------------- #
# 单词拼写
# --------------------------------------------------------------------------- #
class SpellInput(BaseModel):
    """拼写判定请求：目标单词 + 用户作答 + 用户标识。"""

    word: str = Field(..., min_length=1, description="应拼写的单词")
    answer: str = Field(..., min_length=1, description="用户输入的拼写")
    user_id: str = Field(..., min_length=1, description="用户 ID")

    _strip_fields = field_validator("word", "answer", "user_id")(_require_non_blank)


class SpellResult(BaseModel):
    """拼写判定结果。"""

    is_correct: bool
    confidence: float = Field(..., ge=0, le=1)
    confidence_level: ConfidenceLevel


# --------------------------------------------------------------------------- #
# 音素对齐
# --------------------------------------------------------------------------- #
class PhoneSpan(BaseModel):
    """单个音素的时序区间。"""

    phone: str
    start: float = Field(..., ge=0, description="起始秒")
    end: float = Field(..., ge=0, description="结束秒")
    confidence: float = Field(..., ge=0, le=1)


class AlignInput(BaseModel):
    """音素对齐请求。"""

    audio_base64: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)

    _strip_fields = field_validator("audio_base64", "text")(_require_non_blank)


class AlignResult(BaseModel):
    """音素对齐结果。"""

    spans: list[PhoneSpan] = Field(default_factory=list)
    duration: float = Field(0.0, ge=0, description="音频总时长（秒）")


# --------------------------------------------------------------------------- #
# TTS
# --------------------------------------------------------------------------- #
class TTSInput(BaseModel):
    """文本转语音请求。"""

    text: str = Field(..., min_length=1)
    voice: str = Field("default", description="音色标识")

    _strip_fields = field_validator("text", "voice")(_require_non_blank)


class TTSResult(BaseModel):
    """文本转语音结果。"""

    audio_base64: str
    duration: float = Field(..., ge=0)

"""Pydantic v2 request/response models for the AI service."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class ConfidenceLevel(StrEnum):
    """置信度等级，与 speech 服务保持一致的边界定义。"""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class LearnerLevel(StrEnum):
    """学习者水平，对齐产品侧学段划分。"""

    BEGINNER = "beginner"
    ELEMENTARY = "elementary"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


class ApiResponse(BaseModel):
    """统一响应信封，与 NestJS API 侧 `{code, message, data}` 对齐。"""

    code: int = 0
    message: str = "ok"
    data: Any = None


def _require_non_blank(value: str) -> str:
    """拒绝仅由空白字符组成的输入，并返回 strip 后的值。"""

    trimmed = value.strip()
    if not trimmed:
        raise ValueError("字段不能为空或仅包含空白字符")
    return trimmed


# --------------------------------------------------------------------------- #
# 对话
# --------------------------------------------------------------------------- #
class ChatMessage(BaseModel):
    """单条对话消息。"""

    role: str = Field(..., pattern=r"^(system|user|assistant)$")
    content: str = Field(..., min_length=1)

    _strip_content = field_validator("content")(_require_non_blank)


class ChatInput(BaseModel):
    """多轮对话请求。"""

    messages: list[ChatMessage] = Field(..., min_length=1)
    context: str | None = None
    user_id: str = Field(..., min_length=1)

    _strip_user_id = field_validator("user_id")(_require_non_blank)


class ChatResponse(BaseModel):
    """对话响应。"""

    message: str
    confidence: float = Field(1.0, ge=0, le=1)
    degraded: bool = False


# --------------------------------------------------------------------------- #
# 翻译
# --------------------------------------------------------------------------- #
class TranslateInput(BaseModel):
    """翻译请求。"""

    text: str = Field(..., min_length=1)
    target_lang: str = Field("zh-CN", min_length=2)

    _strip_text = field_validator("text", "target_lang")(_require_non_blank)


class TranslateResponse(BaseModel):
    """翻译响应。"""

    source: str
    translated: str
    notes: list[str] = Field(default_factory=list)
    degraded: bool = False


# --------------------------------------------------------------------------- #
# 单词讲解
# --------------------------------------------------------------------------- #
class ExplainInput(BaseModel):
    """单词讲解请求。"""

    word: str = Field(..., min_length=1)
    user_level: LearnerLevel = LearnerLevel.BEGINNER

    _strip_word = field_validator("word")(_require_non_blank)


class ExplainResponse(BaseModel):
    """单词讲解响应。"""

    word: str
    phonetic: str = ""
    meaning_cn: str = ""
    part_of_speech: str = ""
    examples: list[str] = Field(default_factory=list)
    memory_tip: str = ""
    degraded: bool = False


# --------------------------------------------------------------------------- #
# 口语陪练
# --------------------------------------------------------------------------- #
class SpeakFeedbackInput(BaseModel):
    """口语陪练反馈请求。"""

    text: str = Field(..., min_length=1)
    level: LearnerLevel = LearnerLevel.BEGINNER

    _strip_text = field_validator("text")(_require_non_blank)


class Correction(BaseModel):
    """单条纠错建议。"""

    original: str
    suggested: str
    reason: str = ""


class SpeakFeedbackResponse(BaseModel):
    """口语陪练反馈响应。"""

    summary: str = ""
    strengths: list[str] = Field(default_factory=list)
    corrections: list[Correction] = Field(default_factory=list)
    suggestion: str = ""
    degraded: bool = False


# --------------------------------------------------------------------------- #
# 情景对话生成
# --------------------------------------------------------------------------- #
class ConversationGenerateInput(BaseModel):
    """情景对话生成请求。"""

    topic: str = Field(..., min_length=1)
    level: LearnerLevel = LearnerLevel.BEGINNER
    user_id: str = Field(..., min_length=1)

    _strip_topic = field_validator("topic", "user_id")(_require_non_blank)


class ConversationTurn(BaseModel):
    """对话中的单轮。"""

    role: str = Field(..., pattern=r"^(user|assistant)$")
    text: str = Field(..., min_length=1)


class ConversationGenerateResponse(BaseModel):
    """情景对话生成响应。"""

    topic: str
    level: LearnerLevel
    turns: list[ConversationTurn] = Field(default_factory=list)
    degraded: bool = False

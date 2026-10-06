"""EnglishForge AI service —— FastAPI 应用入口。

启动：``uvicorn ai.main:app --reload``

依赖注入约定（DIP）：业务路由只依赖 ``Router``，Router 内部只依赖 ``LLMAdapter``
协议，不 import 任何 SDK。默认按环境变量选择适配器，测试通过
``app.dependency_overrides`` 注入脚本化实现。
"""

from __future__ import annotations

from fastapi import Depends, FastAPI

from .llm_adapter import LLMCompletion
from .models import (
    ApiResponse,
    ChatInput,
    ChatResponse,
    ConversationGenerateInput,
    ConversationGenerateResponse,
    ConversationTurn,
    ExplainInput,
    ExplainResponse,
    SpeakFeedbackInput,
    SpeakFeedbackResponse,
    TranslateInput,
    TranslateResponse,
)
from .prompts import (
    CONVERSATION_GENERATE_PROMPT,
    EXPLAIN_WORD_PROMPT,
    SPEAK_FEEDBACK_PROMPT,
    TRANSLATE_PROMPT,
)
from .router import Router, build_router

SERVICE_NAME = "ai"
SERVICE_VERSION = "1.0.0"

DEFAULT_TEMPERATURE = 0.4


def get_router() -> Router:
    """默认 Provider：按环境变量构建。测试中可覆盖为注入适配器。"""

    return build_router()


def _system_prompt() -> str:
    """服务级系统提示词，集中管理便于评审。"""

    return (
        "You are the AI assistant inside EnglishForge, a learning app for English learners "
        "of all school stages. Be concise, encouraging and age-appropriate. "
        "When asked for structured output, reply with valid JSON only."
    )


def create_app() -> FastAPI:
    """构建 FastAPI 应用。使用工厂便于测试中重复创建实例。"""

    app = FastAPI(
        title="EnglishForge AI Service",
        version=SERVICE_VERSION,
        description="对话 / 翻译 / 单词讲解 / 口语陪练 / 情景对话生成",
    )

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok", "service": SERVICE_NAME, "version": SERVICE_VERSION}

    @app.post("/chat", response_model=ApiResponse)
    def chat(payload: ChatInput, router: Router = Depends(get_router)) -> ApiResponse:
        """多轮对话。"""

        messages: list[dict[str, str]] = [{"role": "system", "content": _system_prompt()}]
        if payload.context:
            messages.append({"role": "system", "content": f"Additional context: {payload.context}"})
        messages.extend(m.model_dump() for m in payload.messages)

        completion = router.complete(messages, temperature=DEFAULT_TEMPERATURE)
        result = ChatResponse(
            message=completion.content or "（AI 暂不可用，请稍后重试）",
            confidence=0.6 if completion.degraded else 0.95,
            degraded=completion.degraded,
        )
        return ApiResponse(code=0, message="ok", data=result.model_dump(mode="json"))

    @app.post("/translate", response_model=ApiResponse)
    def translate(payload: TranslateInput, router: Router = Depends(get_router)) -> ApiResponse:
        """文本翻译。"""

        prompt = TRANSLATE_PROMPT.format(text=payload.text, target_lang=payload.target_lang)
        data, degraded = router.complete_json([_message(prompt)], temperature=DEFAULT_TEMPERATURE)

        if data is None:
            result = TranslateResponse(
                source=payload.text,
                translated="",
                notes=[],
                degraded=True,
            )
        else:
            result = TranslateResponse(
                source=str(data.get("source") or payload.text),
                translated=str(data.get("translated") or ""),
                notes=[str(n) for n in data.get("notes") or []],
                degraded=False,
            )
        return ApiResponse(code=0, message="ok", data=result.model_dump(mode="json"))

    @app.post("/explain", response_model=ApiResponse)
    def explain(payload: ExplainInput, router: Router = Depends(get_router)) -> ApiResponse:
        """单词讲解，按学习者水平自适应。"""

        level = payload.user_level.value
        prompt = EXPLAIN_WORD_PROMPT.format(word=payload.word, level=level)
        data, degraded = router.complete_json([_message(prompt)], temperature=DEFAULT_TEMPERATURE)

        if data is None:
            result = ExplainResponse(word=payload.word, degraded=True)
        else:
            result = ExplainResponse(
                word=str(data.get("word") or payload.word),
                phonetic=str(data.get("phonetic") or ""),
                meaning_cn=str(data.get("meaning_cn") or ""),
                part_of_speech=str(data.get("part_of_speech") or ""),
                examples=[str(e) for e in data.get("examples") or []],
                memory_tip=str(data.get("memory_tip") or ""),
                degraded=False,
            )
        return ApiResponse(code=0, message="ok", data=result.model_dump(mode="json"))

    @app.post("/speak-practice", response_model=ApiResponse)
    def speak_practice(payload: SpeakFeedbackInput, router: Router = Depends(get_router)) -> ApiResponse:
        """口语陪练反馈。"""

        prompt = SPEAK_FEEDBACK_PROMPT.format(text=payload.text, level=payload.level.value)
        data, degraded = router.complete_json([_message(prompt)], temperature=DEFAULT_TEMPERATURE)

        if data is None:
            result = SpeakFeedbackResponse(degraded=True)
        else:
            result = SpeakFeedbackResponse(
                summary=str(data.get("summary") or ""),
                strengths=[str(s) for s in data.get("strengths") or []],
                corrections=[
                    {
                        "original": str(c.get("original") or ""),
                        "suggested": str(c.get("suggested") or ""),
                        "reason": str(c.get("reason") or ""),
                    }
                    for c in data.get("corrections") or []
                    if isinstance(c, dict)
                ],
                suggestion=str(data.get("suggestion") or ""),
                degraded=False,
            )
        return ApiResponse(code=0, message="ok", data=result.model_dump(mode="json"))

    @app.post("/conversation-generate", response_model=ApiResponse)
    def conversation_generate(
        payload: ConversationGenerateInput, router: Router = Depends(get_router)
    ) -> ApiResponse:
        """情景对话生成。"""

        level = payload.level.value
        prompt = CONVERSATION_GENERATE_PROMPT.format(topic=payload.topic, level=level)
        data, degraded = router.complete_json([_message(prompt)], temperature=DEFAULT_TEMPERATURE)

        if data is None:
            result = ConversationGenerateResponse(topic=payload.topic, level=payload.level, degraded=True)
        else:
            turns: list[ConversationTurn] = []
            for turn in data.get("turns") or []:
                if isinstance(turn, dict):
                    turns.append(
                        ConversationTurn(role=str(turn.get("role", "assistant")), text=str(turn.get("text") or ""))
                    )
            result = ConversationGenerateResponse(
                topic=str(data.get("topic") or payload.topic),
                level=payload.level,
                turns=turns,
                degraded=False,
            )
        return ApiResponse(code=0, message="ok", data=result.model_dump(mode="json"))

    return app


def _message(content: str, role: str = "user") -> dict[str, str]:
    """构造单条 user 消息。"""

    return {"role": role, "content": content}


app = create_app()


__all__ = [
    "ApiResponse",
    "ChatInput",
    "ChatResponse",
    "LLMCompletion",
    "Router",
    "app",
    "create_app",
]

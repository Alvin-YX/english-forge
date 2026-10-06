"""LLM 路由：按环境变量选择适配器，并统一处理降级。

配置矩阵（``AI_PROVIDER``）：

| provider | 行为                                              |
| -------- | ------------------------------------------------- |
| ``fake`` | 使用 :class:`FakeLLM`，不产生任何外部调用（默认） |
| ``openai`` | 使用 :class:`OpenAIAdapter`（需 ``AI_API_KEY``）  |
| ``cloud``  | 使用 :class:`CloudAPIAdapter`（需 key + 地址）     |

**降级保证**：
1. 请求的 provider 缺少 API key / 缺少必要配置 → 回退 :class:`FakeLLM`。
2. 运行时调用抛 :class:`LLMError` → 返回 ``degraded=True`` 的兜底结果。
3. 模型返回非 JSON（结构化端点） → 返回 ``degraded=True`` 的默认值。

任何一条路径都不会让业务端点抛 500。
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any

from .llm_adapter import (
    DEFAULT_MODEL,
    DEFAULT_TIMEOUT,
    CloudAPIAdapter,
    FakeLLM,
    LLMAdapter,
    LLMCompletion,
    LLMError,
    OpenAIAdapter,
)

logger = logging.getLogger(__name__)

_PROVIDER_FAKE = "fake"
_PROVIDER_OPENAI = "openai"
_PROVIDER_CLOUD = "cloud"
_SUPPORTED_PROVIDERS = {_PROVIDER_FAKE, _PROVIDER_OPENAI, _PROVIDER_CLOUD}

_FENCE_PATTERN = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE | re.MULTILINE)


@dataclass(frozen=True)
class RouterConfig:
    """路由配置。字段与同名环境变量一一对应，缺省值见 :func:`load_config`。"""

    provider: str = _PROVIDER_FAKE
    api_key: str | None = None
    model: str = DEFAULT_MODEL
    base_url: str | None = None
    cloud_url: str | None = None
    timeout: float = DEFAULT_TIMEOUT


def load_config() -> RouterConfig:
    """从环境变量读取配置。未知 provider 记日志后回退 fake。"""

    provider = os.getenv("AI_PROVIDER", _PROVIDER_FAKE).strip().lower()
    if provider not in _SUPPORTED_PROVIDERS:
        logger.warning("未知 AI_PROVIDER=%s，回退到 fake", provider)
        provider = _PROVIDER_FAKE

    timeout_raw = os.getenv("AI_TIMEOUT", "").strip()
    timeout = DEFAULT_TIMEOUT
    if timeout_raw:
        try:
            timeout = max(1.0, float(timeout_raw))
        except ValueError:
            logger.warning("AI_TIMEOUT=%s 非法，使用默认 %.0fs", timeout_raw, DEFAULT_TIMEOUT)

    return RouterConfig(
        provider=provider,
        api_key=os.getenv("AI_API_KEY", "").strip() or None,
        model=os.getenv("AI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL,
        base_url=os.getenv("AI_BASE_URL", "").strip() or None,
        cloud_url=os.getenv("AI_CLOUD_URL", "").strip() or None,
        timeout=timeout,
    )


def resolve_adapter(config: RouterConfig | None = None) -> tuple[LLMAdapter, bool]:
    """按配置解析适配器，返回 ``(adapter, fell_back_to_fake)``。

    回退策略：配置不全（缺 key / 缺云端地址 / 未知 provider）一律回退 FakeLLM，
    确保服务在任何配置状态下都可启动。
    """

    cfg = config or load_config()

    if cfg.provider == _PROVIDER_OPENAI:
        if not cfg.api_key:
            logger.warning("AI_PROVIDER=openai 但未设置 AI_API_KEY，回退 FakeLLM")
            return FakeLLM(), True
        try:
            return OpenAIAdapter(cfg.api_key, model=cfg.model, base_url=cfg.base_url, timeout=cfg.timeout), False
        except LLMError as exc:
            logger.warning("OpenAIAdapter 初始化失败（%s），回退 FakeLLM", exc)
            return FakeLLM(), True

    if cfg.provider == _PROVIDER_CLOUD:
        if not cfg.api_key or not cfg.cloud_url:
            logger.warning("AI_PROVIDER=cloud 但缺少 AI_API_KEY 或 AI_CLOUD_URL，回退 FakeLLM")
            return FakeLLM(), True
        try:
            adapter = CloudAPIAdapter(cfg.api_key, cfg.cloud_url, model=cfg.model, timeout=cfg.timeout)
            return adapter, False
        except LLMError as exc:
            logger.warning("CloudAPIAdapter 初始化失败（%s），回退 FakeLLM", exc)
            return FakeLLM(), True

    return FakeLLM(), False


def strip_code_fence(text: str) -> str:
    """去除模型输出中常见的 markdown 代码围栏。"""

    return _FENCE_PATTERN.sub("", text).strip()


def extract_json(text: str) -> dict[str, Any] | None:
    """从模型输出中解析 JSON 对象；失败返回 ``None``（由调用方决定降级）。"""

    candidate = strip_code_fence(text)
    if not candidate:
        return None
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        # 容忍输出前后有额外说明文字：截取第一个 { 到最后一个 }
        start, end = candidate.find("{"), candidate.rfind("}")
        if start == -1 or end <= start:
            return None
        try:
            parsed = json.loads(candidate[start : end + 1])
        except json.JSONDecodeError:
            return None
    return parsed if isinstance(parsed, dict) else None


class Router:
    """LLM 调用门面：持有适配器并提供安全调用入口。"""

    def __init__(self, adapter: LLMAdapter, *, initial_degraded: bool = False) -> None:
        self._adapter = adapter
        self.initial_degraded = initial_degraded

    @property
    def adapter(self) -> LLMAdapter:
        return self._adapter

    def complete(self, messages: list[dict[str, str]], **kwargs: Any) -> LLMCompletion:
        """安全调用：任何异常都转为降级结果，不向调用方抛异常。"""

        if self.initial_degraded:
            return LLMCompletion(content="Fake AI response", degraded=True, reason="adapter fell back to fake")
        try:
            return LLMCompletion(content=self._adapter.complete(messages, **kwargs))
        except LLMError as exc:
            logger.warning("LLM 调用失败，返回降级结果：%s", exc)
            return LLMCompletion(content="", degraded=True, reason=str(exc))
        except Exception as exc:  # 防御性兜底：任何未预期异常都不应导致 500
            logger.exception("LLM 调用出现未预期异常")
            return LLMCompletion(content="", degraded=True, reason=repr(exc))

    def complete_json(self, messages: list[dict[str, str]], **kwargs: Any) -> dict[str, Any] | None:
        """调用并解析 JSON 对象；失败（故障/空输出/非 JSON）时返回 ``None``。

        调用方以「是否为 ``None``」判定是否降级，避免额外的布尔标志位。
        """

        completion = self.complete(messages, **kwargs)
        if completion.degraded or not completion.content:
            return None
        data = extract_json(completion.content)
        if data is None:
            logger.warning("LLM 输出非 JSON，返回降级结果：%s", completion.content[:200])
            return None
        return data


def build_router(config: RouterConfig | None = None) -> Router:
    """工厂：解析配置并构建 Router（生产路径）。"""

    adapter, fell_back = resolve_adapter(config)
    return Router(adapter, initial_degraded=fell_back)

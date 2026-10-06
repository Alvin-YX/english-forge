"""LLM 适配层：Protocol 抽象 + 三套实现。

依赖倒置（DIP）：路由层只依赖 :class:`LLMAdapter` 协议，不 import 任何 SDK。

实现一览：
- :class:`FakeLLM` —— 测试/本地默认，零外部依赖。
- :class:`OpenAIAdapter` —— ``openai`` SDK，兼容任何 OpenAI 协议的 endpoint。
- :class:`CloudAPIAdapter` —— 通用 HTTP 云端接口（仅依赖 ``httpx``）。

``openai`` 采用惰性导入：未安装时模块仍可正常加载，只有真正实例化
:class:`OpenAIAdapter` 才会抛 :class:`LLMError`。这保证 ``AI_PROVIDER=fake``
的部署无需安装 openai SDK。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

if TYPE_CHECKING:
    # 仅供类型检查：``OpenAI`` 运行时可能是 None（SDK 未安装），
    # 因此这里声明为 Any，避免把 ``OpenAI = None`` 视为给类型赋值。
    OpenAI: Any
else:
    try:
        from openai import OpenAI
    except ImportError:  # pragma: no cover - 取决于是否安装 openai SDK
        OpenAI = None


DEFAULT_MODEL = "gpt-4o-mini"
DEFAULT_TIMEOUT = 30.0


class LLMError(RuntimeError):
    """LLM 调用失败。由路由层捕获并转为降级响应，不会向客户端抛 500。"""


@runtime_checkable
class LLMAdapter(Protocol):
    """大模型调用协议。

    :param messages: OpenAI 风格的消息列表，每项形如 ``{"role": ..., "content": ...}``。
    :param kwargs: 透传给具体实现的参数（如 ``temperature``、``max_tokens``）。
    :return: 模型输出的纯文本。
    :raises LLMError: 调用失败（网络、鉴权、限流、解析等）。
    """

    def complete(self, messages: list[dict[str, str]], **kwargs: Any) -> str: ...


class FakeLLM:
    """测试与本地开发用的假实现：返回固定文本，不产生任何外部调用。"""

    def complete(self, messages: list[dict[str, str]], **kwargs: Any) -> str:
        return "Fake AI response"


class OpenAIAdapter:
    """OpenAI 兼容接口适配器。

    通过 ``base_url`` 可指向任何 OpenAI 兼容网关（本地 Ollama、vLLM、国内中转等）。
    """

    def __init__(
        self,
        api_key: str,
        model: str = DEFAULT_MODEL,
        base_url: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        if OpenAI is None:
            raise LLMError("openai SDK 未安装：pip install openai 或将 AI_PROVIDER 设为 fake")
        if not api_key:
            raise LLMError("OpenAIAdapter 缺少 api_key")
        self._client: Any = OpenAI(api_key=api_key, base_url=base_url, timeout=timeout)
        self._model = model

    def complete(self, messages: list[dict[str, str]], **kwargs: Any) -> str:
        try:
            response = self._client.chat.completions.create(model=self._model, messages=messages, **kwargs)
        except Exception as exc:  # 网络/鉴权/限流统一收敛为 LLMError
            raise LLMError(f"openai call failed: {exc}") from exc
        content: str | None = response.choices[0].message.content
        if not content:
            raise LLMError("openai returned empty content")
        return content


class CloudAPIAdapter:
    """通用 HTTP 云端接口适配器。

    假定云端实现 OpenAI 兼容的 ``/chat/completions`` 协议；若云端协议不同，
    可覆盖 :meth:`_extract_content` 与 :meth:`_build_payload` 两个钩子。
    """

    def __init__(
        self,
        api_key: str,
        cloud_url: str,
        model: str = DEFAULT_MODEL,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        if not api_key:
            raise LLMError("CloudAPIAdapter 缺少 api_key")
        if not cloud_url:
            raise LLMError("CloudAPIAdapter 缺少 cloud_url")
        self._api_key = api_key
        self._cloud_url = cloud_url.rstrip("/")
        self._model = model
        self._timeout = timeout

    def _build_payload(self, messages: list[dict[str, str]], **kwargs: Any) -> dict[str, Any]:
        payload: dict[str, Any] = {"model": self._model, "messages": messages}
        payload.update(kwargs)
        return payload

    def _extract_content(self, body: Any) -> str:
        """从云端响应中提取文本；结构不符一律抛 :class:`LLMError`。"""

        try:
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError(f"cloud api response parse failed: {exc}") from exc
        if not isinstance(content, str) or not content:
            raise LLMError("cloud api returned empty content")
        return content

    def complete(self, messages: list[dict[str, str]], **kwargs: Any) -> str:
        import httpx

        try:
            response = httpx.post(
                f"{self._cloud_url}/chat/completions",
                json=self._build_payload(messages, **kwargs),
                headers={"Authorization": f"Bearer {self._api_key}"},
                timeout=self._timeout,
            )
            response.raise_for_status()
            return self._extract_content(response.json())
        except httpx.HTTPError as exc:
            raise LLMError(f"cloud api call failed: {exc}") from exc
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError(f"cloud api response parse failed: {exc}") from exc


@dataclass(frozen=True)
class LLMCompletion:
    """一次 LLM 调用的结果，携带降级标记。"""

    content: str
    degraded: bool = False
    reason: str = field(default="", repr=False)

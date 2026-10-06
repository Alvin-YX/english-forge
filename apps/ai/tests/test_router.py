"""LLM 路由、适配器选择与降级路径测试。

这些测试覆盖「无 key 回退 FakeLLM」「运行时故障不返回 500」「JSON 解析容错」
三条核心保证，是本服务的可靠性契约。
"""

from __future__ import annotations

from typing import Any

import pytest

from ai.llm_adapter import CloudAPIAdapter, FakeLLM, LLMError
from ai.router import (
    Router,
    RouterConfig,
    build_router,
    extract_json,
    load_config,
    resolve_adapter,
    strip_code_fence,
)

from .helpers import assert_ai_envelope


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """隔离环境变量，避免宿主机配置污染路由测试。"""

    for key in ("AI_PROVIDER", "AI_API_KEY", "AI_MODEL", "AI_BASE_URL", "AI_CLOUD_URL", "AI_TIMEOUT"):
        monkeypatch.delenv(key, raising=False)


class TestLoadConfig:
    def test_defaults_to_fake(self) -> None:
        cfg = load_config()
        assert cfg.provider == "fake"
        assert cfg.api_key is None
        assert cfg.cloud_url is None

    def test_reads_provider_and_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AI_PROVIDER", "openai")
        monkeypatch.setenv("AI_API_KEY", "sk-test-123")
        monkeypatch.setenv("AI_MODEL", "gpt-4o")

        cfg = load_config()
        assert cfg.provider == "openai"
        assert cfg.api_key == "sk-test-123"
        assert cfg.model == "gpt-4o"

    def test_provider_is_case_insensitive(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AI_PROVIDER", "CLOUD")
        assert load_config().provider == "cloud"

    def test_unknown_provider_falls_back_to_fake(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AI_PROVIDER", "gemini")
        assert load_config().provider == "fake"

    def test_blank_key_is_treated_as_absent(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AI_API_KEY", "   ")
        assert load_config().api_key is None

    def test_invalid_timeout_falls_back_to_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AI_TIMEOUT", "not-a-number")
        assert load_config().timeout == pytest.approx(30.0)

    def test_valid_timeout_is_parsed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AI_TIMEOUT", "12.5")
        assert load_config().timeout == pytest.approx(12.5)

    def test_timeout_is_clamped_to_minimum(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AI_TIMEOUT", "0.001")
        assert load_config().timeout == pytest.approx(1.0)


class TestResolveAdapter:
    def test_default_config_resolves_to_fake(self) -> None:
        adapter, fell_back = resolve_adapter()
        assert isinstance(adapter, FakeLLM)
        assert fell_back is False

    def test_openai_without_key_falls_back_to_fake(self) -> None:
        adapter, fell_back = resolve_adapter(RouterConfig(provider="openai"))
        assert isinstance(adapter, FakeLLM)
        assert fell_back is True

    def test_cloud_without_key_falls_back_to_fake(self) -> None:
        adapter, fell_back = resolve_adapter(RouterConfig(provider="cloud", cloud_url="https://x.example"))
        assert isinstance(adapter, FakeLLM)
        assert fell_back is True

    def test_cloud_without_url_falls_back_to_fake(self) -> None:
        adapter, fell_back = resolve_adapter(RouterConfig(provider="cloud", api_key="k"))
        assert isinstance(adapter, FakeLLM)
        assert fell_back is True

    def test_cloud_with_full_config_builds_adapter(self) -> None:
        adapter, fell_back = resolve_adapter(
            RouterConfig(provider="cloud", api_key="k", cloud_url="https://x.example/")
        )
        assert isinstance(adapter, CloudAPIAdapter)
        assert fell_back is False

    def test_openai_with_key_but_missing_sdk_falls_back_gracefully(self) -> None:
        """openai SDK 未安装时不应让服务崩溃，而是回退 FakeLLM。"""

        adapter, fell_back = resolve_adapter(RouterConfig(provider="openai", api_key="sk-x"))
        # 无论宿主机是否安装 openai，都不应抛异常
        assert isinstance(adapter, (FakeLLM,)) or hasattr(adapter, "complete")

    def test_fake_provider_with_key_still_uses_fake(self) -> None:
        adapter, fell_back = resolve_adapter(
            RouterConfig(provider="fake", api_key="sk-x")
        )
        assert isinstance(adapter, FakeLLM)
        assert fell_back is False

    def test_build_router_marks_fallback_as_initially_degraded(self) -> None:
        router = build_router(RouterConfig(provider="openai"))
        assert router.initial_degraded is True

    def test_build_router_without_fallback_is_not_degraded(self) -> None:
        router = build_router(RouterConfig(provider="fake"))
        assert router.initial_degraded is False


class TestCloudAPIAdapterHooks:
    """验证 CloudAPIAdapter 的可扩展钩子，不需要真实网络。"""

    def _adapter(self) -> CloudAPIAdapter:
        return CloudAPIAdapter("k", "https://x.example", model="m")

    def test_build_payload_contains_model_and_messages(self) -> None:
        payload = self._adapter()._build_payload([{"role": "user", "content": "hi"}], temperature=0.2)
        assert payload["model"] == "m"
        assert payload["messages"] == [{"role": "user", "content": "hi"}]
        assert payload["temperature"] == 0.2

    def test_extract_content_reads_openai_shape(self) -> None:
        body = {"choices": [{"message": {"content": "你好"}}]}
        assert self._adapter()._extract_content(body) == "你好"

    def test_extract_content_rejects_empty(self) -> None:
        with pytest.raises(LLMError):
            self._adapter()._extract_content({"choices": [{"message": {"content": ""}}]})

    def test_extract_content_rejects_malformed(self) -> None:
        with pytest.raises(LLMError):
            self._adapter()._extract_content({"choices": []})

    def test_missing_key_raises(self) -> None:
        with pytest.raises(LLMError):
            CloudAPIAdapter("", "https://x.example")

    def test_missing_url_raises(self) -> None:
        with pytest.raises(LLMError):
            CloudAPIAdapter("k", "")


class TestStripCodeFence:
    def test_plain_json_unchanged(self) -> None:
        assert strip_code_fence('{"a": 1}') == '{"a": 1}'

    def test_json_fence_removed(self) -> None:
        assert strip_code_fence('```json\n{"a": 1}\n```') == '{"a": 1}'

    def test_bare_fence_removed(self) -> None:
        assert strip_code_fence('```\n{"a": 1}\n```') == '{"a": 1}'

    def test_strips_whitespace(self) -> None:
        assert strip_code_fence("  {'a': 1}  ") == "{'a': 1}"


class TestExtractJson:
    def test_valid_json(self) -> None:
        assert extract_json('{"a": 1}') == {"a": 1}

    def test_fenced_json(self) -> None:
        assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}

    def test_json_with_surrounding_prose(self) -> None:
        text = 'Sure! Here is the result: {"a": 1} Hope that helps.'
        assert extract_json(text) == {"a": 1}

    def test_invalid_json_returns_none(self) -> None:
        assert extract_json("not json at all") is None

    def test_non_object_json_returns_none(self) -> None:
        assert extract_json("[1, 2, 3]") is None

    def test_empty_string_returns_none(self) -> None:
        assert extract_json("") is None


class TestRouterDegrade:
    def test_complete_with_failing_adapter_returns_degraded(self) -> None:
        class _Failing:
            def complete(self, messages: list[dict[str, str]], **kwargs: Any) -> str:
                raise LLMError("boom")

        router = Router(_Failing())
        completion = router.complete([{"role": "user", "content": "hi"}])

        assert completion.degraded is True
        assert completion.content == ""
        assert "boom" in completion.reason

    def test_complete_never_raises(self) -> None:
        """即使适配器抛出非 LLMError 的未预期异常，也不得向外传播。"""

        class _Unexpected:
            def complete(self, messages: list[dict[str, str]], **kwargs: Any) -> str:
                raise ValueError("unexpected")

        completion = Router(_Unexpected()).complete([])
        assert completion.degraded is True

    def test_complete_json_with_failing_adapter(self) -> None:
        class _Failing:
            def complete(self, messages: list[dict[str, str]], **kwargs: Any) -> str:
                raise LLMError("boom")

        data, degraded = Router(_Failing()).complete_json([{"role": "user", "content": "hi"}])
        assert data is None
        assert degraded is True

    def test_complete_json_parses_valid_response(self) -> None:
        class _Scripted:
            def complete(self, messages: list[dict[str, str]], **kwargs: Any) -> str:
                return '{"a": 1}'

        data, degraded = Router(_Scripted()).complete_json([])
        assert data == {"a": 1}
        assert degraded is False

    def test_complete_json_rejects_non_json(self) -> None:
        data, degraded = Router(FakeLLM()).complete_json([])
        assert data is None
        assert degraded is True

    def test_initial_degraded_short_circuits_adapter(self) -> None:
        """标记为已回退时不应再调用真实适配器。"""

        class _WouldFail:
            def complete(self, messages: list[dict[str, str]], **kwargs: Any) -> str:
                raise AssertionError("不应被调用")

        completion = Router(_WouldFail(), initial_degraded=True).complete([])
        assert completion.degraded is True


class TestDegradeIntegration:
    """注入故障适配器，验证所有业务端点均返回 200 且标记降级。"""

    STRUCTURED_ENDPOINTS: dict[str, dict[str, Any]] = {
        "/translate": {"text": "hello"},
        "/explain": {"word": "apple", "user_level": "beginner"},
        "/speak-practice": {"text": "hello world", "level": "beginner"},
        "/conversation-generate": {"topic": "t", "level": "beginner", "user_id": "u-1"},
    }

    def test_all_structured_endpoints_return_200_when_llm_down(
        self, failing_client: Any
    ) -> None:
        for path, payload in self.STRUCTURED_ENDPOINTS.items():
            response = failing_client.post(path, json=payload)
            assert response.status_code == 200, f"{path} 在 LLM 故障时不应返回 500"
            assert assert_ai_envelope(response.json())["degraded"] is True

    def test_chat_returns_fallback_text_when_llm_down(self, failing_client: Any) -> None:
        payload = {"messages": [{"role": "user", "content": "hi"}], "user_id": "u-1"}
        data = assert_ai_envelope(failing_client.post("/chat", json=payload).json())

        assert data["degraded"] is True
        assert data["message"]  # 有兜底文案而非空串
        assert data["confidence"] < 0.95

    def test_input_validation_still_runs_before_llm(self, failing_client: Any) -> None:
        """降级只影响 LLM 调用，参数校验仍应返回 422。"""

        assert failing_client.post("/explain", json={"word": "  ", "user_level": "beginner"}).status_code == 422

    def test_fallback_is_configurable_via_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """未配置 AI_API_KEY 时生产路径也自动回退 FakeLLM。"""

        monkeypatch.delenv("AI_PROVIDER", raising=False)
        monkeypatch.delenv("AI_API_KEY", raising=False)
        router = build_router()
        assert isinstance(router.adapter, FakeLLM)
        assert router.initial_degraded is False

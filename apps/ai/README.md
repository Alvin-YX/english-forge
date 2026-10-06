# EnglishForge AI Service

对话、翻译、单词讲解、口语陪练反馈与情景对话生成服务。

技术栈：Python 3.13 + FastAPI + Pydantic v2 + OpenAI SDK。

## 端点

| Method | Path                     | 说明                                   |
| ------ | ------------------------ | -------------------------------------- |
| GET    | `/healthz`               | 健康检查，返回 `{status, service, version}` |
| POST   | `/chat`                  | 多轮对话                               |
| POST   | `/translate`             | 文本翻译                               |
| POST   | `/explain`               | 单词讲解（按学习者水平自适应）           |
| POST   | `/speak-practice`        | 口语陪练反馈                           |
| POST   | `/conversation-generate` | 情景对话生成                           |

## LLM 适配与降级

所有大模型调用都收敛到 `LLMAdapter` 协议，业务代码只依赖协议，不直接 import SDK：

- `FakeLLM` —— 测试与本地开发默认实现，零外部依赖。
- `OpenAIAdapter` —— 使用 `openai` SDK 调用 OpenAI 兼容接口。
- `CloudAPIAdapter` —— 通用 HTTP 云端接口（可配置 base_url/model）。

`router.get_adapter()` 按环境变量选择实现，配置优先级：

| 变量          | 说明                                        |
| ------------- | ------------------------------------------- |
| `AI_PROVIDER` | `openai` / `cloud` / `fake`，默认 `fake`    |
| `AI_API_KEY`  | API key；**缺失时自动回退 `FakeLLM`**       |
| `AI_MODEL`    | 模型名，默认 `gpt-4o-mini`                  |
| `AI_BASE_URL` | 自定义 endpoint（OpenAI 兼容协议）          |
| `AI_CLOUD_URL`| `CloudAPIAdapter` 的云端地址               |
| `AI_TIMEOUT`  | 请求超时秒数，默认 30                        |

> **降级保证**：任何配置缺失或运行时异常都不会让请求 500。未配置 key 时使用
> `FakeLLM`；已配置 key 但调用失败时，adapter 内部捕获异常并返回带 `degraded=true`
> 标记的兜底文本，由路由层记录告警日志。

## 响应信封

与 NestJS API 侧约定一致，业务端点统一返回 `{code, message, data}`：

```json
{ "code": 0, "message": "ok", "data": { "...": "..." } }
```

## 合规

仅参考与学习开源项目的设计思路，不复制其代码。本服务默认不联网（`AI_PROVIDER=fake`），
不会在测试与开发环境产生任何外部调用。

## 开发与测试

```bash
python -m pip install -r requirements.txt
pytest
ruff check src tests
mypy src
```

本地启动：

```bash
uvicorn ai.main:app --reload
```

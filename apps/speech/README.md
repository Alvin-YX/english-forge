# EnglishForge Speech Service

跟读评分（shadow reading scoring）、音素对齐（phoneme alignment）与文本转语音（TTS）服务。

技术栈：Python 3.13 + FastAPI + Pydantic v2。

## 端点

| Method | Path            | 说明                                             |
| ------ | --------------- | ------------------------------------------------ |
| GET    | `/healthz`      | 健康检查，返回 `{status, service, version}`       |
| POST   | `/score/shadow` | 跟读评分，返回五维分数 + 置信度 + 降级等级        |
| POST   | `/score/spell`  | 单词拼写判定，返回是否正确 + 置信度               |
| POST   | `/align/phoneme`| 音素时间轴对齐，返回音素 span 列表                |
| POST   | `/tts`          | 文本转语音，返回 base64 音频 + 时长               |

## 评分模型

综合分采用固定加权公式：

```
overall = accuracy * 0.35 + fluency * 0.25 + completeness * 0.20 + prosody * 0.20
```

置信度等级：`high`（≥0.8）、`medium`（0.5–0.8）、`low`（<0.5）。
降级等级 A–F：A=high 且无噪声，B=high，C=medium，D=low 且有噪声，E=low，F=critical error。

## 依赖注入

所有重型依赖（评分引擎、对齐器、TTS 引擎）均以 `typing.Protocol` 抽象，业务代码只依赖协议接口，不 import 具体实现。测试中注入 `FakeScorer` / `FakeAligner` / `FakeTTS`，无需真实音频处理即可跑通全链路。

## 开发与测试

```bash
python -m pip install -r requirements.txt
pytest
ruff check src tests
mypy src
```

本地启动：

```bash
uvicorn speech.main:app --reload
```

"""TTS 引擎的 Protocol 抽象与 Fake 实现。"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class TTSEngine(Protocol):
    """文本转语音协议。

    :param text: 待合成文本。
    :param voice: 音色标识。
    :return: 音频字节（格式由具体实现决定，例如 wav / mp3）。
    """

    def synthesize(self, text: str, voice: str) -> bytes: ...


class FakeTTS:
    """测试用假 TTS：返回固定字节，避免拉起真实语音模型。"""

    def synthesize(self, text: str, voice: str) -> bytes:  # 入参仅用于满足协议签名
        return b"fake_audio_data"

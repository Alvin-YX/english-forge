FROM python:3.12-slim AS base
WORKDIR /app

# 用国内可达的 Debian 镜像源替代 deb.debian.org（fnOS/NAS 上后者常网络不通或抖动）。
# 动态读取发行版代号（bookworm/trixie），避免硬编码 suite 名导致 apt 找不到包。
#
# 系统依赖说明（对应文档 §5.3 音素级评测四步链路）：
#   libportaudio2 / libasound2 —— 音频设备访问（librosa/soxr 的运行时依赖）
#   ffmpeg                       —— 链路第 0 步：webm/opus 转码 16kHz 单声道 wav
#   espeak-ng                    —— 链路步骤③：预期文本 → IPA 音素序列
RUN CODENAME=$(. /etc/os-release && echo $VERSION_CODENAME) && \
    echo "deb http://mirrors.aliyun.com/debian ${CODENAME} main" > /etc/apt/sources.list && \
    echo "deb http://mirrors.aliyun.com/debian-security ${CODENAME}-security main" >> /etc/apt/sources.list && \
    rm -f /etc/apt/sources.list.d/debian.sources && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        libportaudio2 libasound2 ffmpeg espeak-ng && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps（使用阿里云 PyPI 镜像加速并规避网络限制）
#
# 默认只装 requirements.txt（核心依赖），因为 Fake 实现足以跑通全链路与测试。
# 要装真实引擎依赖（torch / faster-whisper / transformers / piper-tts 等），
# 构建时加 --build-arg WITH_PIPELINE=1：
#
#     docker build --build-arg WITH_PIPELINE=1 -t englishforge-speech .
COPY apps/speech/pyproject.toml apps/speech/requirements.txt apps/speech/requirements-pipeline.txt ./
ARG WITH_PIPELINE=0
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt \
    && if [ "$WITH_PIPELINE" = "1" ]; then \
         pip install --no-cache-dir -r requirements-pipeline.txt; \
       fi

# Copy source
COPY apps/speech/ ./

# 源码位于 /app/src（src 布局），必须显式加入模块搜索路径，
# 否则 `uvicorn speech.main:app` 会因找不到 speech 包而启动失败。
ENV PYTHONPATH=/app/src

EXPOSE 8001
CMD ["uvicorn", "speech.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]

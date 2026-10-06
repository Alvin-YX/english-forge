FROM python:3.13-slim AS base
WORKDIR /app

# System deps for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libportaudio2 libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY apps/speech/pyproject.toml apps/speech/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY apps/speech/ ./

# 源码位于 /app/src（src 布局），必须显式加入模块搜索路径，
# 否则 `uvicorn speech.main:app` 会因找不到 speech 包而启动失败。
ENV PYTHONPATH=/app/src

EXPOSE 8001
CMD ["uvicorn", "speech.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]

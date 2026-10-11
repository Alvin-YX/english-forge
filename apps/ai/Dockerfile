FROM python:3.12-slim AS base
WORKDIR /app

COPY apps/ai/pyproject.toml apps/ai/requirements.txt ./
# 使用阿里云 PyPI 镜像加速并规避网络限制（deb.debian.org 在 NAS 上常不通）
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt

COPY apps/ai/ ./

# 源码位于 /app/src（src 布局），必须显式加入模块搜索路径，
# 否则 `uvicorn ai.main:app` 会因找不到 ai 包而启动失败。
ENV PYTHONPATH=/app/src

EXPOSE 8002
CMD ["uvicorn", "ai.main:app", "--host", "0.0.0.0", "--port", "8002", "--workers", "2"]

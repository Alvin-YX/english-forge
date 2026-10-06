FROM python:3.13-slim AS base
WORKDIR /app

COPY apps/ai/pyproject.toml apps/ai/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/ai/ ./

EXPOSE 8002
CMD ["uvicorn", "ai.main:app", "--host", "0.0.0.0", "--port", "8002", "--workers", "2"]

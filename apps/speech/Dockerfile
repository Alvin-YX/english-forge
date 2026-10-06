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

EXPOSE 8001
CMD ["uvicorn", "speech.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]

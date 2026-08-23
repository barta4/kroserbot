# ==========================================================
# KroserBot - Python Scraper Dockerfile
# Repository: alfredobartaburu/kroserbot-scraper
# ==========================================================

# --- Stage 1: Dependencies Builder ---
FROM python:3.10-slim AS builder
WORKDIR /app
COPY scraper/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# --- Stage 2: Production Runner ---
FROM python:3.10-slim AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="KroserBot Scraper" \
      org.opencontainers.image.description="Scraper e Ingestión de Catálogo para Kroser Uruguay" \
      org.opencontainers.image.authors="alfredobartaburu" \
      org.opencontainers.image.version="1.0.0"

ENV PYTHONUNBUFFERED=1

COPY --from=builder /usr/local/lib/python3.10/site-packages /usr/local/lib/python3.10/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY scraper ./scraper

CMD ["python", "-m", "scraper", "run", "--resume"]

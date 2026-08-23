# Multi-stage Dockerfile for Python Scraper
FROM python:3.10-slim AS builder
WORKDIR /app
COPY scraper/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.10-slim AS runner
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.10/site-packages /usr/local/lib/python3.10/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY scraper ./scraper

CMD ["python", "-m", "scraper", "run"]

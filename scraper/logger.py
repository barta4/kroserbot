"""Logging estructurado en JSON para el scraper."""

from __future__ import annotations

import json
import logging
import sys


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        extra = getattr(record, "data", None)
        if extra:
            payload["data"] = extra
        return json.dumps(payload, ensure_ascii=False)


def setup_logging(verbose: bool = False, stream=sys.stdout) -> None:
    logger = logging.getLogger("kroker")
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)
    if not logger.handlers:
        handler = logging.StreamHandler(stream)
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
    logger.propagate = False


def log_event(name: str, data: dict, level: str = "info") -> None:
    logger = logging.getLogger("kroker.scraper")
    getattr(logger, level)(name, extra={"data": data})
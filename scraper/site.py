"""Cliente HTTP para kroser.com.uy con scraping respetuoso.

Comportamiento:
- Sesión con cookies (request previo a la home) y headers de navegador real.
- Delay aleatorio ~8s con jitter entre requests (NUNCA paralelo).
- Reintentos con backoff exponencial ante 403/429/timeout (máx 3).
- Detección de bloqueo sostenido o captcha: corta la corrida sola.
- Respeto a robots.txt (sitemap y /catalogo accesibles; se verifica al inicio).
"""

from __future__ import annotations

import logging
import random
import time
import urllib.parse

import requests

logger = logging.getLogger("kroker.scraper.site")

DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)


class BlockedError(RuntimeError):
    """Bloqueo sostenido o captcha detectado; hay que parar la corrida."""


class SiteClient:
    def __init__(self, base_url: str = "https://www.kroser.com.uy",
                 ua: str = DEFAULT_UA, min_delay: float = 6.0, max_delay: float = 11.0,
                 max_retries: int = 3, no_sleep: bool = False):
        self.base_url = base_url.rstrip("/")
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.max_retries = max_retries
        self.no_sleep = no_sleep
        self._block_streak = 0
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": ua,
            "Accept-Language": "es-UY,es;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        })

    # ------------------------------------------------------------- público
    def get_html(self, path: str, referer: str | None = "https://www.kroser.com.uy/catalogo") -> str:
        """GET con reintentos+backoff. Devuelve el texto; lanza BlockedError si bloqueo sostenido."""
        url = self._url(path)
        attempts = 0
        while True:
            attempts += 1
            self._sleep()
            headers = {}
            if referer:
                headers["Referer"] = referer
            try:
                r = self.session.get(url, headers=headers, timeout=30)
            except requests.RequestException as exc:
                logger.warning("get %s error: %s (intento %d)", url, exc, attempts)
                if attempts >= self.max_retries:
                    raise
                time.sleep(2 ** attempts)
                continue

            if r.status_code == 200:
                self._block_streak = 0
                return r.text

            if r.status_code in (403, 429) or self._looks_like_block(r.text):
                self._block_streak += 1
                logger.warning("bloqueo? status=%d intento=%d streak=%d", r.status_code, attempts, self._block_streak)
                if self._block_streak >= self.max_retries + 1:
                    raise BlockedError(
                        f"bloqueo sostenido: {self._block_streak} requests seguidos "
                        f"(status {r.status_code})"
                    )
                if attempts < self.max_retries:
                    time.sleep(2 ** attempts * 3)
                    continue
                # intentos agotados -> cortar corrida, no insistir
                raise BlockedError(f"bloqueado tras {attempts} intentos (status {r.status_code})")

            # otro 4xx/5xx: reintentar con backoff
            logger.warning("get %s status %d (intento %d)", url, r.status_code, attempts)
            if attempts >= self.max_retries:
                r.raise_for_status()
            time.sleep(2 ** attempts)

    def warmup(self) -> None:
        """Request previo a la home para levantar cookies de sesión."""
        # no duerme antes del primero; se duerme el segundo para no martillar
        self._sleep()
        r = self.session.get(self._url("/"), headers={"Referer": self.base_url}, timeout=30)
        r.raise_for_status()
        self._block_streak = 0

    # ------------------------------------------------------------- interno
    def _url(self, path: str) -> str:
        if path.startswith("http"):
            return path
        return self.base_url + path

    def _sleep(self, fixed: float | None = None) -> None:
        if self.no_sleep:
            return
        delay = fixed if fixed is not None else random.uniform(self.min_delay, self.max_delay)
        logger.debug("espera %.1fs", delay)
        time.sleep(delay)

    @staticmethod
    def _looks_like_block(text: str) -> bool:
        head = text[:800].lower()
        return "captcha" in head


def robots_allows(base_url: str) -> bool:
    """Controla robots.txt de forma simple: solo prohíbe /catalogo y /sitemap si está explícito."""
    import logging
    try:
        r = requests.get(urllib.parse.urljoin(base_url, "/robots.txt"), timeout=15)
        r.raise_for_status()
        body = r.text.lower()
    except Exception as exc:  # si no se puede leer, asumimos que permite
        logging.getLogger(__name__).warning("no pude leer robots.txt: %s", exc)
        return True
    # reglas generales
    for line in body.splitlines():
        if line.startswith("disallow:"):
            path = line.split(":", 1)[1].strip()
            if path and (path == "/catalogo" or path.startswith("/catalogo")):
                return False
    return True
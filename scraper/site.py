"""Cliente HTTP para kroser.com.uy con scraping inteligente anti-bloqueo y anti-detección.

Capacidades inteligentes:
- IntelligentPacer: Ritmo adaptativo gaussiano con jitter, escalado por latencia del servidor y micro-pausas humanas orgánicas.
- BrowserProfileManager: Rotación realista de perfiles de navegador (Chrome, Edge, Safari, Firefox en Win/Mac/Linux) con headers completos Sec-Ch-Ua y Sec-Fetch.
- Chaining dinámico de Referer: Emula el clickstream de un comprador real utilizando la URL previa como Referer.
- Auto-recuperación de sockets TCP: Detecta desconexiones por inactividad (RemoteDisconnected de Fenicio) y recrea sesiones limpias instantáneamente.
- Escudo Anti-Ban Multi-Nivel: Backoff exponencial adaptativo ante 403/429/WAF/Captcha con rotación de identidad y warmup de cookies.
- Soporte transparente para Proxies residenciales o rotativos mediante variables de entorno.
- Fallback tolerante en lectura de robots.txt.
"""

from __future__ import annotations

import logging
import os
import random
import time
import urllib.parse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util import Retry

logger = logging.getLogger("kroker.scraper.site")

# ---------------------------------------------------------------- Perfiles de Navegador
BROWSER_PROFILES = [
    {
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
        "platform": '"Windows"',
        "mobile": "?0",
    },
    {
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
        "sec_ch_ua": '"Not/A)Brand";v="99", "Chromium";v="125", "Microsoft Edge";v="125"',
        "platform": '"Windows"',
        "mobile": "?0",
    },
    {
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
        "platform": '"macOS"',
        "mobile": "?0",
    },
    {
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
        "sec_ch_ua": None,
        "platform": '"macOS"',
        "mobile": "?0",
    },
    {
        "ua": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
        "platform": '"Linux"',
        "mobile": "?0",
    },
]

DEFAULT_UA = BROWSER_PROFILES[0]["ua"]


class BlockedError(RuntimeError):
    """Bloqueo sostenido o captcha detectado; hay que detener la corrida o enfriar."""


# ---------------------------------------------------------------- Pacer Inteligente
class IntelligentPacer:
    """Gestiona el ritmo y la cadencia de navegación humana orgánica."""

    def __init__(self, min_delay: float = 2.5, max_delay: float = 5.5, no_sleep: bool = False):
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.no_sleep = no_sleep
        self.latency_multiplier = 1.0
        self.request_count = 0
        self.next_reading_pause = random.randint(25, 38)

    def calculate_delay(self) -> float:
        if self.no_sleep:
            return 0.0

        # Distribución gaussiana en torno a la media para evitar patrones fijos
        mu = (self.min_delay + self.max_delay) / 2.0
        sigma = (self.max_delay - self.min_delay) / 3.5
        sample = random.gauss(mu, sigma)
        bounded = max(self.min_delay * 0.7, min(self.max_delay * 1.3, sample))

        # Ajuste dinámico por latencia del servidor
        effective_delay = bounded * self.latency_multiplier
        return round(effective_delay, 2)

    def report_latency(self, elapsed_seconds: float) -> None:
        """Adapta el ritmo según la salud y el tiempo de respuesta del servidor."""
        if self.no_sleep:
            return
        if elapsed_seconds > 1.8:
            # Servidor lento o encolando tráfico -> desacelerar preventivamente
            self.latency_multiplier = min(2.5, self.latency_multiplier + 0.3)
            logger.info("[Pacer] Servidor con latencia elevada (%.2fs). Aumentando multiplicador a %.2fx", elapsed_seconds, self.latency_multiplier)
        elif elapsed_seconds < 0.6 and self.latency_multiplier > 1.0:
            # Servidor fluido -> retornar suavemente al ritmo base
            self.latency_multiplier = max(1.0, self.latency_multiplier - 0.1)

    def tick_and_pause_if_needed(self) -> float | None:
        """Determina si corresponde una micro-pausa natural de lectura humana."""
        if self.no_sleep:
            return None
        self.request_count += 1
        if self.request_count >= self.next_reading_pause:
            pause = round(random.uniform(12.0, 20.0), 1)
            logger.info("[Pacer] Micro-pausa natural de lectura: %.1fs tras %d peticiones", pause, self.request_count)
            self.request_count = 0
            self.next_reading_pause = random.randint(25, 38)
            return pause
        return None


# ---------------------------------------------------------------- Cliente HTTP
class SiteClient:
    def __init__(
        self,
        base_url: str = "https://www.kroser.com.uy",
        ua: str | None = None,
        min_delay: float = 2.5,
        max_delay: float = 5.5,
        max_retries: int = 3,
        no_sleep: bool = False,
    ):
        self.base_url = base_url.rstrip("/")
        self.custom_ua = ua
        self.max_retries = max_retries
        self.no_sleep = no_sleep
        self.pacer = IntelligentPacer(min_delay=min_delay, max_delay=max_delay, no_sleep=no_sleep)
        self._block_streak = 0
        self.last_visited_url: str | None = f"{self.base_url}/catalogo"
        self.session: requests.Session | None = None
        self.session_requests_done = 0
        self._init_session()

    def _init_session(self) -> None:
        """Crea una sesión limpia con headers realistas y connection pooling robusto."""
        if self.session is not None:
            try:
                self.session.close()
            except Exception:
                pass

        profile = random.choice(BROWSER_PROFILES)
        self.session = requests.Session()
        self.session_requests_done = 0

        # Proxies opcionales si están configurados
        proxy = os.environ.get("SCRAPER_PROXY") or os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
        if proxy:
            self.session.proxies = {"http": proxy, "https": proxy}
            logger.info("[SiteClient] Proxy configurado para scraper: %s", proxy.split("@")[-1])

        retries = Retry(
            total=3,
            connect=3,
            read=3,
            backoff_factor=1.0,
            status_forcelist=[429, 500, 502, 503, 504],
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retries, pool_connections=5, pool_maxsize=5)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

        headers = {
            "User-Agent": self.custom_ua or profile["ua"],
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Language": "es-UY,es-419;q=0.9,es;q=0.8,en;q=0.7",
            "Accept-Encoding": "gzip, deflate, br",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
        }
        if not self.custom_ua and profile.get("sec_ch_ua"):
            headers["Sec-Ch-Ua"] = profile["sec_ch_ua"]
            headers["Sec-Ch-Ua-Mobile"] = profile.get("mobile", "?0")
            headers["Sec-Ch-Ua-Platform"] = profile["platform"]

        self.session.headers.update(headers)

    def _reset_session(self) -> None:
        """Renueva la sesión, sockets TCP y huella del navegador tras desconexión o bloqueo."""
        logger.info("[SiteClient] Recreando sesión HTTP limpia con nueva huella y sockets...")
        self._init_session()

    # ------------------------------------------------------------- público
    def get_html(self, path: str, referer: str | None = None) -> str:
        """GET inteligente con ritmo adaptativo, chaining de Referer y recuperación anti-bloqueo."""
        url = self._url(path)
        attempts = 0

        # Reciclaje preventivo cada 70 peticiones para evitar sockets TCP zombies
        self.session_requests_done += 1
        if self.session_requests_done >= 70:
            self._reset_session()

        # Determinar Referer dinámico contextual
        chosen_referer = referer or self.last_visited_url or f"{self.base_url}/catalogo"

        while True:
            attempts += 1

            # Pausa natural o cálculo de delay inteligente
            pause = self.pacer.tick_and_pause_if_needed()
            if pause:
                time.sleep(pause)
            else:
                delay = self.pacer.calculate_delay()
                if delay > 0:
                    time.sleep(delay)

            headers = {"Referer": chosen_referer}

            t0 = time.time()
            try:
                r = self.session.get(url, headers=headers, timeout=30)
                elapsed = time.time() - t0
                self.pacer.report_latency(elapsed)
            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as exc:
                logger.warning("[SiteClient] get %s error de socket (%s) - reintentando con sesión fresca", url, exc)
                self._reset_session()
                if attempts >= self.max_retries:
                    raise
                time.sleep(min(2 ** attempts, 10))
                continue
            except requests.RequestException as exc:
                logger.warning("[SiteClient] get %s error general (%s)", url, exc)
                self._reset_session()
                if attempts >= self.max_retries:
                    raise
                time.sleep(min(2 ** attempts, 10))
                continue

            if r.status_code == 200:
                self._block_streak = 0
                self.last_visited_url = url
                return r.text

            # Detección de Bloqueo / Rate-Limit (403, 429, 503 o Captcha)
            if r.status_code in (403, 429, 503) or self._looks_like_block(r.text):
                self._block_streak += 1
                logger.warning(
                    "[Anti-Ban] Señal de bloqueo detectada (status=%d, streak=%d, url=%s)",
                    r.status_code,
                    self._block_streak,
                    url,
                )

                if self._block_streak > self.max_retries + 1:
                    raise BlockedError(
                        f"Bloqueo sostenido tras {self._block_streak} peticiones (status {r.status_code})"
                    )

                # Escalado inteligente por niveles
                if self._block_streak == 1:
                    cooldown = random.uniform(25.0, 35.0)
                elif self._block_streak == 2:
                    cooldown = random.uniform(60.0, 80.0)
                else:
                    cooldown = random.uniform(120.0, 150.0)

                logger.info("[Anti-Ban] Enfriando %.1fs, rotando sesión y realizando warmup...", cooldown)
                time.sleep(cooldown)
                self._reset_session()
                self.warmup()
                continue

            # Otros errores HTTP 4xx/5xx: backoff exponencial
            logger.warning("[SiteClient] get %s devolvió status %d (intento %d)", url, r.status_code, attempts)
            if attempts >= self.max_retries:
                r.raise_for_status()
            time.sleep(2 ** attempts)

    def warmup(self) -> None:
        """Visita la página de inicio para establecer cookies válidas de navegación."""
        try:
            time.sleep(1.0)
            r = self.session.get(self._url("/"), headers={"Referer": self.base_url}, timeout=25)
            if r.status_code == 200:
                self._block_streak = 0
                self.last_visited_url = f"{self.base_url}/"
                logger.info("[SiteClient] Warmup inicial de sesión completado")
        except Exception as exc:
            logger.warning("[SiteClient] Warmup inicial tuvo advertencia: %s (continuando)", exc)
            self._reset_session()

    # ------------------------------------------------------------- interno
    def _url(self, path: str) -> str:
        if path.startswith("http"):
            return path
        if not path.startswith("/"):
            path = "/" + path
        return self.base_url + path

    @staticmethod
    def _looks_like_block(text: str) -> bool:
        head = text[:1500].lower()
        signatures = [
            "captcha",
            "cf-browser-verification",
            "just a moment...",
            "ray id",
            "access denied",
            "demasiadas peticiones",
            "bloqueo temporal",
        ]
        return any(sig in head for sig in signatures)


def robots_allows(base_url: str) -> bool:
    """Controla robots.txt de forma permisiva y tolerante a fallos de red/DNS."""
    try:
        session = requests.Session()
        session.headers.update({
            "User-Agent": DEFAULT_UA,
            "Accept": "text/plain,*/*",
        })
        r = session.get(urllib.parse.urljoin(base_url, "/robots.txt"), timeout=15)
        if r.status_code != 200:
            return True
        body = r.text.lower()
    except Exception as exc:
        logging.getLogger(__name__).warning("[Robots] No se pudo leer robots.txt (asumiendo permitido): %s", exc)
        return True

    for line in body.splitlines():
        if line.startswith("disallow:"):
            path = line.split(":", 1)[1].strip()
            if path and (path == "/catalogo" or path.startswith("/catalogo")):
                return False
    return True
"""Descubrimiento inteligente y resiliente de productos vía sitemap.

Mecanismos:
1. Prioridad directa: https://www.kroser.com.uy/sitemap/catalogo-articulos.xml (~3391 productos en 1 sola petición).
2. Fallback de índice: /sitemap y resolución de sub-sitemaps.
3. Fallback estándar: /sitemap.xml.
4. Caché de persistencia local: Si la red falla temporalmente en el sitemap, recupera la última lista conocida.
"""

from __future__ import annotations

import json
import logging
import os

from .products import parse_product_sitemap, parse_sitemap_index
from .site import SiteClient

logger = logging.getLogger("kroker.scraper.sitemap")
CACHE_FILE = os.path.join(os.path.dirname(__file__), ".sitemap_cache.json")


def _save_cache(urls: list[str]) -> None:
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump({"total": len(urls), "urls": urls}, f, ensure_ascii=False)
        logger.debug("[Sitemap] Guardadas %d URLs en caché local", len(urls))
    except Exception as exc:
        logger.warning("[Sitemap] No se pudo guardar caché local: %s", exc)


def _load_cache() -> list[str]:
    if not os.path.exists(CACHE_FILE):
        return []
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            urls = data.get("urls", [])
            logger.info("[Sitemap] Recuperadas %d URLs desde caché local resiliente", len(urls))
            return urls
    except Exception as exc:
        logger.warning("[Sitemap] Error leyendo caché local: %s", exc)
        return []


def discover_product_urls(client: SiteClient) -> list[str]:
    """Devuelve la lista de producto_url del sitemap de artículos con descubrimiento multi-vía."""
    candidates = [
        "https://www.kroser.com.uy/sitemap/catalogo-articulos.xml",
        "/sitemap",
        "/sitemap.xml",
    ]
    index_xml = None
    last_exc = None

    for cand in candidates:
        try:
            logger.info("[Sitemap] Consultando sitemap en: %s", cand)
            content = client.get_html(cand)
            if "<sitemap" in content or "<urlset" in content:
                index_xml = content
                logger.info("[Sitemap] Sitemap recibido con éxito desde: %s", cand)
                break
        except Exception as exc:
            last_exc = exc
            logger.warning("[Sitemap] Falló consulta en %s: %s", cand, exc)

    if not index_xml:
        cached = _load_cache()
        if cached:
            return cached
        if last_exc:
            raise last_exc
        return []

    # Si es directamente un urlset con productos (ej: catalogo-articulos.xml directo)
    if "<urlset" in index_xml and "<loc>" in index_xml:
        urls = parse_product_sitemap(index_xml)
        if urls:
            logger.info("[Sitemap] Sitemap directo reportó %d URLs de productos", len(urls))
            _save_cache(urls)
            return urls

    # Si es un sitemapindex, buscar específicamente el hijo de artículos/productos
    children = parse_sitemap_index(index_xml)
    art_url = None
    # Prioridad 1: sitemap de artículos/productos individuales
    for u in children:
        if "catalogo-articulos" in u or "articulos" in u or "product" in u:
            art_url = u
            break
    # Prioridad 2: si no hay de artículos, probar de catálogo
    if art_url is None:
        for u in children:
            if "catalogo" in u:
                art_url = u
                break
    if art_url is None and children:
        art_url = children[0]
    if not art_url:
        art_url = "https://www.kroser.com.uy/sitemap/catalogo-articulos.xml"

    try:
        xml_text = client.get_html(art_url)
        urls = parse_product_sitemap(xml_text)
        logger.info("[Sitemap] Sub-sitemap reportó %d URLs de productos", len(urls))
        if urls:
            _save_cache(urls)
        return urls
    except Exception as exc:
        logger.warning("[Sitemap] Error al consultar sub-sitemap %s: %s", art_url, exc)
        cached = _load_cache()
        if cached:
            return cached
        raise
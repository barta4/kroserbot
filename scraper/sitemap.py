"""Descubrimiento de productos vía sitemap (mecanismo primario).

Flujo confirmado: GET /sitemap.xml -> índice; localizamos catalogo-artículos.xml;
parseamos <url> y devolvemos ~3401 producto_url.
"""

from __future__ import annotations

import logging

from .products import parse_product_sitemap, parse_sitemap_index
from .site import SiteClient

logger = logging.getLogger("kroker.scraper.sitemap")


def discover_product_urls(client: SiteClient) -> list[str]:
    """Devuelve la lista de producto_url del sitemap de articulos."""
    index_xml = client.get_html("/sitemap.xml")
    children = parse_sitemap_index(index_xml)
    art_url = None
    for u in children:
        if "articulos" in u or "product" in u:
            art_url = u
            break
    if art_url is None and children:
        art_url = children[0]
    if not art_url:
        logger.warning("index de sitemap sin hijos")
        return []
    xml_text = client.get_html(art_url)
    urls = parse_product_sitemap(xml_text)
    logger.info("sitemap report %d producto URLs", len(urls))
    return urls
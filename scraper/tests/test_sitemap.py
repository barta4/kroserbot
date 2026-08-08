"""Test de descubrimiento por sitemap usando el archivo real capturado."""

from __future__ import annotations

from scraper.products import parse_product_sitemap, parse_sitemap_index

INDEX_XML = """<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://www.kroser.com.uy/sitemap/destacados.xml</loc></sitemap>
  <sitemap><loc>https://www.kroser.com.uy/sitemap/catalogo.xml</loc></sitemap>
  <sitemap><loc>https://www.kroser.com.uy/sitemap/catalogo-articulos.xml</loc></sitemap>
</sitemapindex>
"""

ARTICLES_XML = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.kroser.com.uy/catalogo/hoja_7303371_7303371</loc></url>
  <url><loc>https://www.kroser.com.uy/catalogo/pico_10240315035_10240315035</loc></url>
</urlset>
"""


def test_sitemap_index():
    children = parse_sitemap_index(INDEX_XML)
    assert "catalogo-articulos.xml" in " ".join(children)


def test_articles_sitemap():
    urls = parse_product_sitemap(ARTICLES_XML)
    assert len(urls) == 2
    assert urls[0].endswith("7303371_7303371")
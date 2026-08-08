"""Tests unitarios del scraper (no tocan red ni base).

Sample real capturado de la ficha (Fenicio).
"""

from __future__ import annotations

import json

from scraper.products import parse_product, parse_product_list, sku_from_url

SAMPLE = {
    "sku": {"fen": "1:7303371:7303371:U:1", "com": "7303371"},
    "producto": {
        "codigo": "7303371",
        "nombre": "HOJA DE SIERRA AC.CARBONO 18",
        "categoria": "Herramientas > Accesorios",
        "marca": "Krozer",
    },
    "variante": {
        "codigo": "7303371",
        "nombre": "N/a",
        "img": {"u": "//f.fcdn.app/imgs/xxx/460x460/foja.jpg"},
        "url": "https://www.kroser.com.uy/catalogo/foja_7303371_7303371",
        "tieneStock": True,
    },
    "precioMonto": 121,
    "moneda": {"cod": "UYU", "sim": "$"},
    "sale": False,
}


def _ficha(payload: str) -> str:
    return f'    <div id="_jsonDataFicha_">{payload}</div>'


def _sample_html(data=None) -> str:
    return _ficha(json.dumps(data or SAMPLE, ensure_ascii=False))


def test_parse_product_basico():
    p = parse_product(_sample_html(), SAMPLE["variante"]["url"])
    assert p is not None
    assert p.sku == "7303371"
    assert p.nombre.startswith("HOJA DE")
    assert p.precio == 121
    assert p.stock_status == "in_stock"
    assert p.imagen_url == "https://f.fcdn.app/imgs/xxx/460x460/foja.jpg"
    assert p.producto_url == SAMPLE["variante"]["url"]


def test_parse_product_sin_ficha_devuelve_none():
    assert parse_product("<html></html>", "http://x") is None


def test_hash_cambia_con_precio():
    a = parse_product(_sample_html(), "http://x")
    b = parse_product(_sample_html({**SAMPLE, "precioMonto": 222}), "http://x")
    assert a and b
    assert a.hash != b.hash


def test_hash_estable_con_datos_iguales():
    a = parse_product(_sample_html(), "http://x")
    b = parse_product(_sample_html(), "http://x")
    assert a and b
    assert a.hash == b.hash


def test_sku_from_url():
    assert sku_from_url("/catalogo/hoja_7303371_7303371") == "7303371"
    assert sku_from_url("/catalogo/otra_100200300") == "100200300"
    assert sku_from_url("/catalogo/random") == "random"


def test_parse_product_list_escaped_json():
    raw = (
        json.dumps(SAMPLE)
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    html = '<input type="hidden" class="json" value="%s">' % raw
    items = parse_product_list(html)
    assert len(items) == 1
    assert items[0].sku == "7303371"
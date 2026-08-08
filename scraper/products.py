"""Descubrimiento de productos y parseo de datos.

Mecanismos confirmados en el sitio real (ago 2026):
- sitemap.xml -> sitemap/catalogo-articulos.xml lista ~3401 URLs de producto (sin lastmod).
- La ficha /catalogo/... incrusta un JSON en `#_jsonDataFicha_` con los datos del producto.
- El listado /catalogo SSR incrusta el mismo JSON por producto en un <input class=json> (fallback).
"""

from __future__ import annotations

import hashlib
import json
import re
import xml.etree.ElementTree as ET

FICHA_RE = re.compile(r'id="_jsonDataFicha_">\s*(\{.*?\})\s*</div>', re.S)
INPUT_RE = re.compile(r'<input[^>]*class="json"[^>]*value="([^"]+)"', re.S)


class Product:
    __slots__ = (
        "sku", "nombre", "precio", "precio_oferta", "marca", "categoria",
        "descripcion", "imagen_url", "producto_url", "stock_status", "hash",
    )

    def __init__(self, sku, nombre, precio, precio_oferta, marca, categoria,
                 descripcion, imagen_url, producto_url, stock_status):
        self.sku = str(sku)
        self.nombre = (nombre or "").strip()
        self.precio = _to_monto(precio)
        self.precio_oferta = _to_monto(precio_oferta)
        self.marca = (marca or "").strip()
        self.categoria = (categoria or "").strip()
        self.descripcion = (descripcion or "").strip()
        self.imagen_url = _url(imagen_url) if imagen_url else ""
        self.producto_url = (producto_url or "").strip()
        self.stock_status = stock_status or "out_of_stock"
        self.hash = hashlib.sha256(json.dumps({
            "n": self.nombre, "p": self.precio, "po": self.precio_oferta,
            "m": self.marca, "c": self.categoria, "d": self.descripcion,
            "i": self.imagen_url, "u": self.producto_url, "s": self.stock_status,
        }, ensure_ascii=False).encode()).hexdigest()

    def to_dict(self) -> dict:
        return {
            "nombre": self.nombre,
            "precio": self.precio,
            "precio_oferta": self.precio_oferta,
            "marca": self.marca,
            "categoria": self.categoria,
            "descripcion": self.descripcion,
            "imagen_url": self.imagen_url,
            "producto_url": self.producto_url,
            "stock_status": self.stock_status,
            "contenido_hash": self.hash,
        }

    def __repr__(self):  # pragma: no cover
        return f"<Product {self.sku} {self.nombre}>"


def _to_monto(val) -> int | None:
    if val is None:
        return None
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def _url(v: str) -> str:
    return v.strip().replace("//", "https://")


def sku_from_url(url: str) -> str:
    """De /catalogo/slugg_7303371_7303371 -> '7303371'. Cae al último segmento si falla."""
    m = re.search(r"_(\d+)(?:_\d+)*$", url)
    if m:
        return m.group(1)
    return url.rstrip("/").rsplit("/", 1)[-1]


def ficha_data(html: str) -> dict | None:
    m = FICHA_RE.search(html)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def _product_from_json(data: dict, url: str) -> Product | None:
    variante = data.get("variante") or {}
    producto = data.get("producto") or {}
    sku = (data.get("sku") or {}).get("com") or variante.get("codigo") or sku_from_url(url)
    img = variante.get("img")
    if isinstance(img, dict):
        img = img.get("u")
    precio, precio_oferta = _precio(data)
    nombre = producto.get("nombre") or data.get("nombre")
    if not nombre or not sku:
        return None
    return Product(
        sku=sku,
        nombre=nombre,
        precio=precio,
        precio_oferta=precio_oferta,
        marca=producto.get("marca"),
        categoria=producto.get("categoria"),
        descripcion=None,  # la ficha no trae descripción en este mecanismo
        imagen_url=img,
        producto_url=variante.get("url") or url,
        stock_status="in_stock" if variante.get("tieneStock") else "out_of_stock",
    )


def _precio(data: dict) -> tuple[int | None, int | None]:
    """Fenicio entrega precioMonto único (sin precio lista/oferta separado en el JSON)."""
    return _to_monto(data.get("precioMonto")), None


def parse_product(html: str, url: str) -> Product | None:
    data = ficha_data(html)
    return _product_from_json(data, url) if data else None


def parse_product_list(html: str) -> list[Product]:
    """Fallback /catalogo: extrae los productos de los inputs con el JSON embebido."""
    results = []
    for m in INPUT_RE.finditer(html):
        raw = m.group(1).replace("&quot;", '"').replace("&gt;", ">").replace("&lt;", "<")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        url = (data.get("variante") or {}).get("url")
        if not url:
            continue
        p = _product_from_json(data, url)
        if p:
            results.append(p)
    return results


# ---------------------------------------------------------------- sitemap
SITEMAP_NS = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}


def parse_sitemap_index(xml_text: str) -> list[str]:
    """Devuelve las URL de los sitemaps hijos del índice."""
    root = ET.fromstring(xml_text)
    return [el.text for el in root.findall(".//s:loc", SITEMAP_NS)]


def parse_product_sitemap(xml_text: str) -> list[str]:
    """Devuelve la lista de URLs de producto del sitemap-child (catalogo-articulos.xml)."""
    root = ET.fromstring(xml_text)
    return [el.text for el in root.findall(".//s:loc", SITEMAP_NS)]
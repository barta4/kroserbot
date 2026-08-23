import pytest
from unittest.mock import MagicMock, patch
from scraper.importers.base import BaseImporter
from scraper.importers.sql_importer import SqlImporter
from scraper.importers.api_importer import ApiImporter

class DummyImporter(BaseImporter):
    def fetch_products(self):
        return []

def test_base_importer_normalization():
    importer = DummyImporter()
    raw = {
        "sku_code": "SKU123",
        "product_name": " Pintura Sintética ",
        "item_price": "450.50",
        "sale_price": "390.00",
        "brand_name": "Inca",
        "stock": "in_stock"
    }
    mapping = {
        "sku": "sku_code",
        "nombre": "product_name",
        "precio": "item_price",
        "precio_oferta": "sale_price",
        "marca": "brand_name",
        "stock_status": "stock"
    }
    normalized = importer.normalize_product(raw, mapping)
    assert normalized["sku"] == "SKU123"
    assert normalized["nombre"] == "Pintura Sintética"
    assert normalized["precio"] == 450.50
    assert normalized["precio_oferta"] == 390.00
    assert normalized["marca"] == "Inca"
    assert normalized["stock_status"] == "in_stock"

def test_sql_importer_sqlite_mock():
    config = {
        "db_type": "sqlite",
        "database": ":memory:",
        "query": "SELECT 'SKU001' as sku, 'Barniz Marino' as nombre, 290.0 as precio"
    }
    importer = SqlImporter(config)
    products = importer.fetch_products()
    assert len(products) == 1
    assert products[0]["sku"] == "SKU001"
    assert products[0]["nombre"] == "Barniz Marino"
    assert products[0]["precio"] == 290.0

@patch("requests.get")
def test_api_importer_mock(mock_get):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "products": [
            {
                "sku": "API-101",
                "nombre": "Pincel 2 pulgadas",
                "precio": 120.0
            }
        ]
    }
    mock_get.return_value = mock_response

    config = {
        "api_url": "https://api.kroser.com.uy/v1/products",
        "api_key": "test_token_123"
    }
    importer = ApiImporter(config)
    products = importer.fetch_products()

    assert len(products) == 1
    assert products[0]["sku"] == "API-101"
    assert products[0]["nombre"] == "Pincel 2 pulgadas"
    assert products[0]["precio"] == 120.0

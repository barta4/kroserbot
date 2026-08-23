from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional

class BaseImporter(ABC):
    """
    Abstract Base Class for product data importers (Scraper, Direct SQL, REST API).
    Ensures all data sources output products in the standardized schema expected by Postgres.
    """

    @abstractmethod
    def fetch_products(self) -> List[Dict[str, Any]]:
        """
        Fetches products from the external source and returns a list of dictionaries.
        Each dict must follow the standardized product schema.
        """
        pass

    def normalize_product(self, raw_data: Dict[str, Any], mapping: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """
        Normalizes raw data from SQL/API using a column mapping dictionary.
        """
        if not mapping:
            mapping = {
                "sku": "sku",
                "nombre": "nombre",
                "precio": "precio",
                "precio_oferta": "precio_oferta",
                "marca": "marca",
                "categoria": "categoria",
                "descripcion": "descripcion",
                "imagen_url": "imagen_url",
                "producto_url": "producto_url",
                "stock_status": "stock_status",
            }

        normalized = {}
        for target_key, source_key in mapping.items():
            val = raw_data.get(source_key)
            if target_key == "precio" and val is not None:
                try:
                    val = float(val)
                except (ValueError, TypeError):
                    val = 0.0
            elif target_key == "precio_oferta" and val is not None:
                try:
                    val = float(val)
                except (ValueError, TypeError):
                    val = None
            normalized[target_key] = val

        # Default fallback values
        normalized["sku"] = str(normalized.get("sku") or "").strip()
        normalized["nombre"] = str(normalized.get("nombre") or "").strip()
        if not normalized.get("stock_status"):
            normalized["stock_status"] = "in_stock"

        return normalized

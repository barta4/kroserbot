import os
import time
import logging
import requests
from typing import List, Dict, Any, Optional
from .base import BaseImporter
from ..logger import log_event

logger = logging.getLogger("kroker.scraper.importers.api")

class ApiImporter(BaseImporter):
    """
    Importer that fetches product data from a remote REST API endpoint.
    Handles pagination, authentication tokens, and exponential backoff retry.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.api_url = self.config.get("api_url") or os.getenv("KROSER_API_URL", "https://api.kroser.com.uy/v1/products")
        self.api_key = self.config.get("api_key") or os.getenv("KROSER_API_KEY", "")
        self.auth_header_name = self.config.get("auth_header_name", "Authorization")
        self.auth_header_format = self.config.get("auth_header_format", "Bearer {key}")
        self.page_size = int(self.config.get("page_size", 50))
        self.max_retries = int(self.config.get("max_retries", 3))
        self.mapping = self.config.get("mapping")

    def _get_headers(self) -> Dict[str, str]:
        headers = {"User-Agent": "KroserBot-Importer/1.0", "Accept": "application/json"}
        if self.api_key:
            headers[self.auth_header_name] = self.auth_header_format.format(key=self.api_key)
        return headers

    def _fetch_page(self, page: int) -> Dict[str, Any]:
        headers = self._get_headers()
        params = {"page": page, "limit": self.page_size}

        for attempt in range(1, self.max_retries + 1):
            try:
                response = requests.get(self.api_url, headers=headers, params=params, timeout=10)
                if response.status_code == 200:
                    return response.json()
                elif response.status_code in (429, 500, 502, 503, 504):
                    sleep_sec = 2 ** attempt
                    log_event("api_retry", {"page": page, "status": response.status_code, "attempt": attempt})
                    time.sleep(sleep_sec)
                else:
                    response.raise_for_status()
            except requests.RequestException as exc:
                if attempt == self.max_retries:
                    raise exc
                time.sleep(2 ** attempt)
        return {}

    def fetch_products(self) -> List[Dict[str, Any]]:
        log_event("api_fetch_start", {"url": self.api_url})
        products = []
        page = 1

        while True:
            data = self._fetch_page(page)
            # Handle different JSON envelope shapes ({ data: [...] } or [...])
            raw_items = []
            if isinstance(data, list):
                raw_items = data
            elif isinstance(data, dict):
                raw_items = data.get("data") or data.get("items") or data.get("products") or []

            if not raw_items:
                break

            for raw in raw_items:
                normalized = self.normalize_product(raw, self.mapping)
                if normalized.get("sku") and normalized.get("nombre"):
                    products.append(normalized)

            if len(raw_items) < self.page_size:
                break  # Reached end of pagination

            page += 1

        log_event("api_fetch_complete", {"count": len(products)})
        return products

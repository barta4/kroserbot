import logging
from typing import List, Dict, Any
from .base import BaseImporter
from ..site import SiteClient, robots_allows, BlockedError
from ..sitemap import discover_product_urls
from ..products import parse_product
from ..logger import log_event

logger = logging.getLogger("kroker.scraper.importers.scraper")

class ScraperImporter(BaseImporter):
    """
    Importer that scrapes HTML pages from Kroser website using fenicio sitemap.
    """

    def __init__(self, site: SiteClient | None = None, limit: int = 0):
        self.site = site if site is not None else SiteClient()
        self.limit = limit

    def fetch_products(self) -> List[Dict[str, Any]]:
        if not robots_allows(self.site.base_url):
            log_event("robots_denied", {})
            raise PermissionError("robots.txt does not allow scraping")

        self.site.warmup()
        urls = discover_product_urls(self.site)
        if self.limit:
            urls = urls[:self.limit]

        products = []
        for url in urls:
            try:
                html = self.site.get_html(url)
                product_obj = parse_product(html, url)
                if product_obj:
                    prod_dict = product_obj.to_dict()
                    prod_dict["hash"] = product_obj.hash
                    products.append(prod_dict)
            except BlockedError:
                log_event("blocked", {"url": url})
                break
            except Exception as exc:
                log_event("error_fetch", {"url": url, "exc": str(exc)})
                continue

        return products

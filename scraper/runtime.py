"""Orquestación de la corrida de scraping.

Flujo:
- valida robots.txt
- warmup de sesión (home -> cookies)
- descubre producto_urls desde el sitemap primario
- crea la corrida (status=running)
- por cada producto: chequea stop_requested -> fetch (retries/backoff) -> parse ->
  compara hash -> upsert solo si cambió (incremental)
- guarda checkpoint posicional (página_actual/producto_actual)
- al terminar marca discontinuos y cierra la corrida (completed/stopped/failed)
"""

from __future__ import annotations

import logging
import time

from .db import Database
from .logger import log_event
from .products import parse_product, sku_from_url
from .site import BlockedError, SiteClient, robots_allows
from .sitemap import discover_product_urls

logger = logging.getLogger("kroker.scraper.runtime")


class _EmptyArgs:
    limit = 0
    no_sleep = False
    resume = False
    fresh = False


class ScraperRuntime:
    def __init__(self, db: Database, args=None, site: SiteClient | None = None):
        self.db = db
        self.site = site if site is not None else SiteClient()
        args = args or _EmptyArgs()
        self.limit = int(getattr(args, "limit", 0))
        self.no_sleep = bool(getattr(args, "no_sleep", False))
        self.resume = bool(getattr(args, "resume", False))
        self.fresh = bool(getattr(args, "fresh", False))
        if self.no_sleep:
            self.site.no_sleep = True

    # ------------------------------------------------------------ status
    def status(self) -> int:
        import json as _json

        run = self.db.active_run()
        last = self.db.last_run_status()
        payload = {
            "state": (run or {}).get("status", "idle"),
            "last": last,
            "run_id": (run or {}).get("id"),
            "producto_actual": (run or {}).get("producto_actual"),
            "nuevos": (run or {}).get("productos_nuevos", 0),
            "actu": (run or {}).get("productos_actualizados", 0),
            "discont": (run or {}).get("productos_discontinuados", 0),
            "stop_requested": bool((run or {}).get("stop_requested")),
        }
        print(_json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    # ------------------------------------------------------------- run
    def execute(self) -> int:
        if not self.no_sleep and not robots_allows(self.site.base_url):
            log_event("robots_denied", {})
            print("[scraper] robots.txt no permite scrapear el catálogo")
            return 3

        try:
            self.site.warmup()
        except Exception as exc:
            log_event("warmup_failed", {"exc": str(exc)})
            return 3

        urls = self._urls()
        if not urls:
            log_event("empty_sitemap", {})
            print("[scraper] No se obtuvieron URLs del sitemap")
            return 3

        active = self.db.active_run()
        if active and not (self.fresh or self.resume):
            print(f"[scraper] Ya hay corrida activa id={active['id']}. Usá stop o --resume.")
            return 1

        run_id = self.db.create_run()
        contadores = {"nuevos": 0, "actu": 0, "discont": 0, "errores": 0}

        start = 0
        if self.resume:
            # el checkpoint vive en la corrida anterior (stopped/failed); la recién
            # creada todavía no tiene producto_actual
            prev = self.db.last_run_checkpoint()
            if prev and prev.get("producto_actual"):
                url = prev["producto_actual"]
                for idx, u in enumerate(urls):
                    if u == url:
                        start = idx
                        break

        log_event("run", {"run_id": run_id, "total": len(urls), "desde": start})
        start_ts = time.time()

        # Check configured data source strategy
        fuente = self.db.get_config("fuente_datos", "scraping")
        fallback_enabled = self.db.get_config("fallback_scraping", "true").lower() in ("true", "1", "yes")

        log_event("run_start", {"fuente": fuente, "fallback": fallback_enabled})

        if fuente != "scraping":
            try:
                products = []
                if fuente == "sql_directo":
                    from .importers import SqlImporter
                    importer = SqlImporter()
                    products = importer.fetch_products()
                elif fuente == "api":
                    from .importers import ApiImporter
                    importer = ApiImporter()
                    products = importer.fetch_products()
                else:
                    print(f"[scraper] Fuente no soportada: {fuente}. Usando scraping.")
                    fuente = "scraping"

                if fuente != "scraping":
                    run_id = self.db.create_run()
                    contadores = {"nuevos": 0, "actu": 0, "discont": 0, "errores": 0}
                    
                    import hashlib
                    seen_skus = set()
                    for p in products:
                        sku = p["sku"]
                        seen_skus.add(sku)
                        
                        # Generate hash if missing
                        if "contenido_hash" not in p:
                            raw_str = f"{p.get('nombre')}{p.get('precio')}{p.get('descripcion')}{p.get('stock_status')}"
                            p["contenido_hash"] = hashlib.sha256(raw_str.encode('utf-8')).hexdigest()

                        cached = self.db.fetch_hash(sku)
                        if cached == p["contenido_hash"]:
                            continue

                        resultado = self.db.upsert_product(sku, p)
                        key = "nuevos" if resultado == "nuevo" else "actu"
                        contadores[key] += 1

                    # Mark discontinued
                    current_skus = self.db.active_skus()
                    for sku in current_skus - seen_skus:
                        self.db.mark_discontinued(sku)
                        contadores["discont"] += 1

                    self.db.finish_run(run_id, "completed", contadores)
                    print(f"[scraper] Ingestión de {fuente} completada: {contadores}")
                    return 0

            except Exception as exc:
                log_event("importer_error", {"fuente": fuente, "exc": str(exc)})
                print(f"[scraper] Error en conector {fuente}: {exc}")
                if not fallback_enabled:
                    return 3
                print("[scraper] Caída a fallback (scraping web)...")

        # Standard Scraping Flow
        try:
            for i in range(start, len(urls)):
                if self.db.need_stop(run_id):
                    self.db.finish_run(run_id, "stopped", contadores)
                    log_event("stop_requested", {"run_id": run_id, "pos": i})
                    return 0

                url = urls[i]
                self.db.update_checkpoint(run_id, i, url, contadores)

                try:
                    html = self.site.get_html(url)
                except BlockedError as exc:
                    log_event("blocked", {"url": url, "exc": str(exc)})
                    self.db.finish_run(run_id, "failed", contadores)
                    return 2
                except Exception as exc:
                    contadores["errores"] += 1
                    log_event("error_fetch", {"url": url, "exc": str(exc)})
                    continue

                product = parse_product(html, url)
                if product is None:
                    contadores["errores"] += 1
                    log_event("error_parse", {"url": url})
                    continue

                cached = self.db.fetch_hash(product.sku)
                if cached == product.hash:
                    log_event("unchanged", {"sku": product.sku})
                    continue

                resultado = self.db.upsert_product(product.sku, product.to_dict())
                key = "nuevos" if resultado == "nuevo" else "actu"
                contadores[key] += 1
                log_event(resultado, {"sku": product.sku, "nombre": product.nombre})

            if self.db.need_stop(run_id):
                self.db.finish_run(run_id, "stopped", contadores)
            else:
                disc = self._mark_discontinued(urls)
                contadores["discont"] += disc
                self.db.finish_run(run_id, "completed", contadores)
                contadores["duracion_s"] = round(time.time() - start_ts, 1)
                log_event("completed", {"run_id": run_id, "duracion_s": contadores["duracion_s"]})
            return 0
        except KeyboardInterrupt:
            self.db.finish_run(run_id, "stopped", contadores)
            print("[scraper] Interrumpido.")
            return 2

    # ------------------------------------------------------------- helpers
    def _urls(self) -> list[str]:
        urls = discover_product_urls(self.site)
        if self.limit:
            urls = urls[: self.limit]
        return urls

    def _mark_discontinued(self, urls: list[str]) -> int:
        seen = {sku_from_url(u) for u in urls}
        current = self.db.active_skus()
        n = 0
        for sku in sorted(current - seen):
            self.db.mark_discontinued(sku)
            log_event("discontinuado", {"sku": sku})
            n += 1
        return n
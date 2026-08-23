import os
import logging
from typing import List, Dict, Any, Optional
from .base import BaseImporter
from ..logger import log_event

logger = logging.getLogger("kroker.scraper.importers.sql")

class SqlImporter(BaseImporter):
    """
    Importer that fetches product data directly from a remote SQL Database (PostgreSQL/MySQL/SQLite).
    Uses read-only queries with low connection timeout.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.host = self.config.get("host") or os.getenv("KROSER_DB_HOST", "localhost")
        self.port = int(self.config.get("port") or os.getenv("KROSER_DB_PORT", 5432))
        self.user = self.config.get("user") or os.getenv("KROSER_DB_USER", "read_only_user")
        self.password = self.config.get("password") or os.getenv("KROSER_DB_PASS", "")
        self.dbname = self.config.get("database") or os.getenv("KROSER_DB_NAME", "kroser_erp")
        self.db_type = self.config.get("db_type") or os.getenv("KROSER_DB_TYPE", "postgresql")
        self.query = self.config.get("query") or os.getenv(
            "KROSER_DB_QUERY",
            "SELECT sku, nombre, precio, precio_oferta, marca, categoria, descripcion, imagen_url, producto_url, stock_status FROM productos"
        )
        self.mapping = self.config.get("mapping")

    def fetch_products(self) -> List[Dict[str, Any]]:
        log_event("sql_fetch_start", {"host": self.host, "db": self.dbname, "type": self.db_type})

        # Dynamically import database drivers depending on configuration
        rows = []
        try:
            if self.db_type == "sqlite":
                import sqlite3
                conn = sqlite3.connect(self.dbname)
                cursor = conn.cursor()
                cursor.execute(self.query)
                columns = [column[0] for column in cursor.description]
                for row in cursor.fetchall():
                    rows.append(dict(zip(columns, row)))
                conn.close()

            elif self.db_type == "postgresql":
                import psycopg2
                import psycopg2.extras
                conn = psycopg2.connect(
                    host=self.host,
                    port=self.port,
                    user=self.user,
                    password=self.password,
                    dbname=self.dbname,
                    connect_timeout=5,
                    options="-c default_transaction_read_only=on"
                )
                cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
                cursor.execute(self.query)
                rows = [dict(row) for row in cursor.fetchall()]
                conn.close()

            elif self.db_type == "mysql":
                # Fallback for MySQL if driver installed
                try:
                    import pymysql
                    conn = pymysql.connect(
                        host=self.host,
                        port=self.port,
                        user=self.user,
                        password=self.password,
                        database=self.dbname,
                        connect_timeout=5,
                        cursorclass=pymysql.cursors.DictCursor
                    )
                    with conn.cursor() as cursor:
                        cursor.execute(self.query)
                        rows = cursor.fetchall()
                    conn.close()
                except ImportError:
                    raise ImportError("pymysql dependency required for MySQL connections")
            else:
                raise ValueError(f"Unsupported db_type: {self.db_type}")

        except Exception as exc:
            log_event("sql_fetch_error", {"exc": str(exc)})
            raise RuntimeError(f"Error fetching from SQL database: {exc}") from exc

        products = []
        for raw in rows:
            normalized = self.normalize_product(raw, self.mapping)
            if normalized.get("sku") and normalized.get("nombre"):
                products.append(normalized)

        log_event("sql_fetch_complete", {"count": len(products)})
        return products

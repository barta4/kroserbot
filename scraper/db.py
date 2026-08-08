"""Acceso a Postgres para el scraper.

Programa contra el esquema definido en 01-base-datos.md:

  productos(id, sku UNIQUE, nombre, precio, precio_oferta, marca, categoria,
            descripcion, imagen_url, producto_url, stock_status, contenido_hash,
            discontinuado, updated_at)

  scraper_runs(id, status, started_at, finished_at, pagina_actual, producto_actual,
               productos_nuevos, productos_actualizados, productos_discontinuados,
               stop_requested)

`pagina_actual` (int) y `producto_actual` (texto, último producto procesado) actúan
como checkpoint posicional para retomar corridas cortadas.
"""

from __future__ import annotations

import datetime as _dt

import psycopg
from psycopg.rows import dict_row


class Database:
    def __init__(self, conn_str: str):
        self.conn_str = conn_str

    def connect(self):
        return psycopg.connect(self.conn_str, row_factory=dict_row)

    # ------------------------------------------------------------- corridas
    def create_run(self) -> int:
        now = _dt.datetime.now(_dt.timezone.utc)
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO scraper_runs (
                        status, started_at, stop_requested,
                        productos_nuevos, productos_actualizados, productos_discontinuados
                    ) VALUES ('running', %s, FALSE, 0, 0, 0)
                    RETURNING id
                    """,
                    (now,),
                )
                return cur.fetchone()["id"]

    def fetch_run(self, run_id: int) -> dict | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM scraper_runs WHERE id = %s", (run_id,))
                return cur.fetchone()

    def active_run(self) -> dict | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM scraper_runs WHERE status = 'running' ORDER BY id DESC LIMIT 1")
                return cur.fetchone()

    def update_checkpoint(self, run_id: int, pagina: int, producto: str, contadores: dict):
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE scraper_runs
                       SET pagina_actual = %s, producto_actual = %s,
                           productos_nuevos = %s, productos_actualizados = %s,
                           productos_discontinuados = %s
                     WHERE id = %s
                    """,
                    (
                        pagina,
                        producto,
                        contadores.get("nuevos", 0),
                        contadores.get("actu", 0),
                        contadores.get("discont", 0),
                        run_id,
                    ),
                )

    def need_stop(self, run_id: int) -> bool:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT stop_requested FROM scraper_runs WHERE id = %s", (run_id,))
                row = cur.fetchone()
                return row is not None and row["stop_requested"]

    def finish_run(self, run_id: int, status: str, contadores: dict):
        now = _dt.datetime.now(_dt.timezone.utc)
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE scraper_runs SET status = %s, finished_at = %s,
                       productos_nuevos = %s, productos_actualizados = %s,
                       productos_discontinuados = %s
                     WHERE id = %s
                    """,
                    (
                        status,
                        now,
                        contadores.get("nuevos", 0),
                        contadores.get("actu", 0),
                        contadores.get("discont", 0),
                        run_id,
                    ),
                )

    def request_stop(self):
        """Marca stop_requested en la corrida activa. Usado por CLI y por POST /scraper/stop."""
        active = self.active_run()
        if not active:
            print("[scraper] No hay corrida activa para detener.")
            return
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE scraper_runs SET stop_requested = TRUE WHERE id = %s", (active["id"],))
        print(f"[scraper] Corrida {active['id']} marcada para detener.")

    def last_run_status(self) -> str | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT status FROM scraper_runs ORDER BY id DESC LIMIT 1")
                row = cur.fetchone()
                return row["status"] if row else None

    # ------------------------------------------------------------- productos
    def fetch_hash(self, sku: str) -> str | None:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT contenido_hash FROM productos WHERE sku = %s", (sku,))
                row = cur.fetchone()
                return row["contenido_hash"] if row else None

    def upsert_product(self, sku: str, fields: dict) -> str:
        """Upsert idempotente por sku. Devuelve 'nuevo' | 'actualizado'."""
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM productos WHERE sku = %s", (sku,))
                existed = cur.fetchone() is not None
                cur.execute(
                    """
                    INSERT INTO productos (sku, nombre, precio, precio_oferta, marca, categoria,
                        descripcion, imagen_url, producto_url, stock_status, contenido_hash,
                        discontinuado, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, FALSE, NOW())
                    ON CONFLICT (sku) DO UPDATE SET
                        nombre = EXCLUDED.nombre, precio = EXCLUDED.precio,
                        precio_oferta = EXCLUDED.precio_oferta, marca = EXCLUDED.marca,
                        categoria = EXCLUDED.categoria, descripcion = EXCLUDED.descripcion,
                        imagen_url = EXCLUDED.imagen_url, producto_url = EXCLUDED.producto_url,
                        stock_status = EXCLUDED.stock_status, contenido_hash = EXCLUDED.contenido_hash,
                        discontinuado = FALSE, updated_at = NOW()
                    """,
                    (
                        sku,
                        fields["nombre"],
                        fields.get("precio"),
                        fields.get("precio_oferta"),
                        fields.get("marca"),
                        fields.get("categoria"),
                        fields.get("descripcion"),
                        fields.get("imagen_url"),
                        fields.get("producto_url"),
                        fields.get("stock_status"),
                        fields["contenido_hash"],
                    ),
                )
                return "nuevo" if not existed else "actualizado"

    def mark_discontinued(self, sku: str):
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE productos SET discontinuado = TRUE, updated_at = NOW() WHERE sku = %s",
                    (sku,),
                )

    def active_skus(self) -> set[str]:
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT sku FROM productos WHERE discontinuado = FALSE")
                return {r["sku"] for r in cur.fetchall()}
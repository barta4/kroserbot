# Scraper de kroker.com.uy

Carpeta principal de la tarea 02. Trae el catálogo de Kroker a la tabla `productos`.

## Mecanismo usado (verificado contra el sitio real, ago 2026)

- **Primario — sitemap:** `GET /sitemap.xml` -> índice -> `sitemap/catalogo-articulas.xml`
  con ~3400 URLs directas de producto. El sitemap de artículos **no trae `lastmod`**,
  así que la detección de cambios es por **hash de contenido** de la ficha.
- **Paginación:** el listado `/catalogo` SSR carga 12 productos y la paginación es
  JS (no responde a `?page=`), por lo que no se usa como fuente principal; se deja
  soporte `parse_product_list` como fallback si algún día levantan el catálogo.
- La ficha incrusta un JSON en `#_jsonDataFicha_` con:
  `sku.com` (sku), `producto.nombre`, `producto.categoria`, `producto.marca`,
  `precioMonto` (precio), `variante.tieneStock`, `variante.img.u` (imagen),
  `variante.url` (producto_url).

## Requisitos

- Python 3.12+
- Postgres con el esquema de la tarea 01 (`productos`, `scraper_runs`).
- Variables en `.env` (ver `.env.example`): `DATABASE_URL`, opcional `KROSER_BASE_URL`.

```bash
pip install -r requirements.txt
```

## Uso

```bash
# corrida nueva (incremental con checkpoint)
python -m scraper run

# retomatar una corrida cortada
python -m scraper run --resume

# forzar completo desde cero
python -m scraper run --fresh

# mejoras locales, sin red ni base reales
python -m scraper run --limit 2 --no-sleep

# detener la corrida activa (cooperativo) — equivalente al endpooint POST /scraper/stop
python -m scraper stop

# estado de la corrida activa
python -m scraper status
```

## Cómo funciona

1. Valida `robots.txt` y hace `warmup` (definición home) para levantar cookies.
2. Descubre las URLs por sitemap.
3. Crea una corrida `status='running'` en `scraper_runs`.
4. Por cada producto, en orden:
   - chequea `stop_requested` (si está en `true` termina limpio: checkpoint + status `stopped`);
   - descarga la ficha con **delay aleatorio ~8s (jitter 6–11)**, un request por vez;
   - reintentos con backoff ante 403/429/timeout (máx 3), **corta solo ante bloqueo sostenido**;
   - parsea la ficha y calcula `contenido_hash`;
   - si el hash no cambió contra `productos.contenido_hash`, **no vuelve a escribir** (incremental);
   - si cambió, hace **upsert idempotente por `sku`** (`ON CONFLICT`).
5. Al terminar, marca `discontinuado=true` los `productos` activos que dejaron de
   aparecer en el sitemap (no borra nada).
6. Cierra la corrida con `completed`/`stopped`/`failed` y contadores.

La columna extra `productos.contenido_hash` se agrega como política del scraper;
si el esquema de la tarea 01 aún no la tiene, corré la migración que va en
`db/migrations/1786214078000_scraper_columns.sql`.

## Tests

```bash
python -m pytest scraper/tests -q
```

## Endpoints usados por el backend (tarea 04)

- `POST /scraper/stop` -> `Database.request_stop()`
- `GET /scraper/status` -> `ScraperRuntime.status()` (state, run_id, producto_actual, contadores, stop_requested)
"""Scraper de Kroser.com.uy — tarea 02.

Uso (desde la raíz del repo):

    python -m scraper run                # corrida nueva (incremental con checkpoint)
    python -m scraper run --resume       # retoma desde el checkpoint guardado
    python -m scraper run --fresh        # fuerza corrida completa ignorando checkpoint
    python -m scraper run --limit 5 --no-sleep   # prueba local sin DB y sin esperas
    python -m scraper stop               # pide detención cooperativa de la corrida activa
    python -m scraper status             # estado de la corrida activa

Variables de entorno (ver /scraper/.env.example):
    DATABASE_URL        conexión a Postgres (productos, scraper_runs)
    KROSER_BASE_URL     base del sitio (default https://www.kroser.com.uy)
    KROSER_DELAY_MIN/MAX segundos de delay con jitter (default 6–11)
"""

from __future__ import annotations
-- Migration: 1786214077188_scraper_columns.sql
-- Description: Agrega columnas usadas por el scraper y por el pipeline de embeddings.
--   - productos.contenido_hash: huella del contenido scrapeado para detección incremental.
--   - scraper_runs.producto_actual / productos_discontinuados: checkpoint posicional y contador.
-- Autor: tarea/02-scraper (columnas también usadas por 03-embeddings-rag)

ALTER TABLE productos ADD COLUMN IF NOT EXISTS contenido_hash TEXT;

ALTER TABLE scraper_runs ADD COLUMN IF NOT EXISTS producto_actual TEXT;
ALTER TABLE scraper_runs ADD COLUMN IF NOT EXISTS productos_discontinuados INTEGER DEFAULT 0;
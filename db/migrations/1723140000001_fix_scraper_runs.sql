-- Migration: 1723140000001_fix_scraper_runs.sql
-- Description: Arregla la tabla scraper_runs:
--   1. Agrega 'error' como valor válido del status
--   2. Agrega columna url_error para registrar qué URL causó el fallo

-- Eliminar el CHECK constraint anterior y recrearlo con 'error'
ALTER TABLE scraper_runs
  DROP CONSTRAINT IF EXISTS scraper_runs_status_check;

ALTER TABLE scraper_runs
  ADD CONSTRAINT scraper_runs_status_check
  CHECK (status IN ('running','stopped','completed','failed','error'));

-- Agregar columna url_error si no existe
ALTER TABLE scraper_runs
  ADD COLUMN IF NOT EXISTS url_error TEXT;

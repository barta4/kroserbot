-- Migration: 1786214600000_embedding_and_unaccent_indexes.sql
-- Description: 
--   1. Add embedding_updated_at to avoid continuous regeneration loop in RAG pipeline.
--   2. Add functional GIN trigram indexes with translate(lower(...)) for fast unaccented search.

-- 1. Columna de control para embeddings incrementales
ALTER TABLE productos ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ;

-- Inicializar productos que ya cuentan con embedding generado
UPDATE productos 
SET embedding_updated_at = COALESCE(updated_at, NOW()) 
WHERE embedding IS NOT NULL AND embedding_updated_at IS NULL;

-- 2. Índices funcionales GIN trigram para búsquedas con y sin tilde
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_productos_nombre_unaccent_trgm 
  ON productos USING gin (translate(lower(nombre), 'áéíóúü', 'aeiouu') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_productos_categoria_unaccent_trgm 
  ON productos USING gin (translate(lower(categoria), 'áéíóúü', 'aeiouu') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_productos_marca_unaccent_trgm 
  ON productos USING gin (translate(lower(marca), 'áéíóúü', 'aeiouu') gin_trgm_ops);

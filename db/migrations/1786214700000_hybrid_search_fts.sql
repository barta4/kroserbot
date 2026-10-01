-- Migration: 1786214700000_hybrid_search_fts.sql
-- Description: Add PostgreSQL Full Text Search (FTS) infrastructure for hybrid search.
--   1. Generated tsvector column with Spanish dictionary for stemming.
--   2. GIN index on tsvector for fast FTS queries.
--   3. Trigram GIN index on descripcion for fuzzy ILIKE searches.

-- 1. Generated tsvector column for Full Text Search in Spanish
ALTER TABLE productos ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('spanish',
      coalesce(nombre, '') || ' ' ||
      coalesce(marca, '') || ' ' ||
      coalesce(categoria, '') || ' ' ||
      coalesce(descripcion, '')
    )
  ) STORED;

-- 2. GIN index on the generated tsvector column
CREATE INDEX IF NOT EXISTS idx_productos_fts
  ON productos USING gin (search_vector);

-- 3. Trigram GIN index on descripcion for fuzzy matching
CREATE INDEX IF NOT EXISTS idx_productos_descripcion_trgm
  ON productos USING gin (descripcion gin_trgm_ops);

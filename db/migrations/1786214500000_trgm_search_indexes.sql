-- Migration: 1786214500000_trgm_search_indexes.sql
-- Description: Create pg_trgm extension and GIN indexes for high-performance ILIKE searches on productos

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_productos_nombre_trgm ON productos USING gin (nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_productos_categoria_trgm ON productos USING gin (categoria gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_productos_marca_trgm ON productos USING gin (marca gin_trgm_ops);

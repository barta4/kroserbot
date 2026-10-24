-- Migration: 1786215600000_enye_normalization.sql
-- Description:
--   1. Función IMMUTABLE para normalizar texto de búsqueda incluyendo la ñ.
--   2. Recrea los índices trigram sobre la función unificada.
--
-- Motivo: el analizador convertía "caño" -> "cano", pero las consultas SQL
-- sólo quitaban tildes de vocales. Los 27 productos con "CAÑO" del catálogo
-- quedaban invisibles para la búsqueda.

CREATE OR REPLACE FUNCTION krosmart_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT translate(lower($1), 'áéíóúüñ', 'aeiouun')
$$;

-- Recrear índices funcionales con la normalización completa (incluye ñ).
DROP INDEX IF EXISTS idx_productos_nombre_unaccent_trgm;
DROP INDEX IF EXISTS idx_productos_categoria_unaccent_trgm;
DROP INDEX IF EXISTS idx_productos_marca_unaccent_trgm;

CREATE INDEX IF NOT EXISTS idx_productos_nombre_unaccent_trgm
  ON productos USING gin (krosmart_unaccent(nombre) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_productos_categoria_unaccent_trgm
  ON productos USING gin (krosmart_unaccent(categoria) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_productos_marca_unaccent_trgm
  ON productos USING gin (krosmart_unaccent(marca) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_productos_descripcion_unaccent_trgm
  ON productos USING gin (krosmart_unaccent(coalesce(descripcion, '')) gin_trgm_ops);

-- Migration: 1786214300000_add_moneda_to_productos.sql
-- Description: Soporte multi-moneda (USD / UYU) en catálogo de productos

ALTER TABLE productos ADD COLUMN IF NOT EXISTS moneda VARCHAR(10) DEFAULT 'USD';

-- Actualizar productos existentes donde el precio es claramente en pesos uruguayos (ej. precios > 250 en herramientas manuales o insumos)
UPDATE productos 
SET moneda = 'UYU' 
WHERE moneda = 'USD' AND (
  nombre ILIKE '%cinta metrica%' OR 
  nombre ILIKE '%cinta métrica%' OR
  nombre ILIKE '%gato de carro%' OR
  nombre ILIKE '%extractor%' OR
  precio >= 200
);

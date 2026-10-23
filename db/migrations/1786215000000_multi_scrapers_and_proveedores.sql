-- Migration: 1786215000000_multi_scrapers_and_proveedores.sql
-- Description: Soporte multi-scraper para Equus y al menos 4 sitios proveedores adicionales,
--              con estipulación de reglas de margen comercial, IVA y prefijos de SKU.

-- 1. Tabla de Proveedores y Fuentes de Scraper
CREATE TABLE IF NOT EXISTS proveedores_scraper (
  id                    SERIAL PRIMARY KEY,
  codigo                VARCHAR(50) UNIQUE NOT NULL,
  nombre                VARCHAR(100) NOT NULL,
  activo                BOOLEAN NOT NULL DEFAULT TRUE,
  prefijo_sku           VARCHAR(20) NOT NULL DEFAULT '',
  margen_porcentaje     NUMERIC(5,2) NOT NULL DEFAULT 30.00,
  costo_incluye_iva     BOOLEAN NOT NULL DEFAULT TRUE,
  aplicar_iva_venta     BOOLEAN NOT NULL DEFAULT FALSE,
  moneda_defecto        VARCHAR(10) NOT NULL DEFAULT 'UYU',
  url_base              TEXT,
  notas                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proveedores_scraper_codigo ON proveedores_scraper(codigo);

-- 2. Semillas iniciales: Equus + 4 sitios adicionales listos para conectar
INSERT INTO proveedores_scraper (codigo, nombre, activo, prefijo_sku, margen_porcentaje, costo_incluye_iva, aplicar_iva_venta, moneda_defecto, url_base, notas)
VALUES
  ('equus', 'Equus Uruguay (Herramientas, Taller y Escaleras)', TRUE, 'EQ-', 35.00, TRUE, FALSE, 'UYU', 'https://www.equus.uy', 'Proveedor B2B mayorista integrado. Costos con IVA incluido.'),
  ('sitio_2', 'Proveedor 2 — Ferretería Industrial', FALSE, 'P2-', 30.00, TRUE, FALSE, 'UYU', NULL, 'Slot preparado para segundo proveedor externo.'),
  ('sitio_3', 'Proveedor 3 — Sanitaria y Grifería', FALSE, 'P3-', 30.00, TRUE, FALSE, 'UYU', NULL, 'Slot preparado para tercer proveedor externo.'),
  ('sitio_4', 'Proveedor 4 — Electricidad e Iluminación', FALSE, 'P4-', 30.00, TRUE, FALSE, 'USD', NULL, 'Slot preparado para cuarto proveedor externo.'),
  ('sitio_5', 'Proveedor 5 — Pinturas y Revestimientos', FALSE, 'P5-', 30.00, TRUE, FALSE, 'UYU', NULL, 'Slot preparado para quinto proveedor externo.')
ON CONFLICT (codigo) DO NOTHING;

-- 3. Columnas en tabla productos para trazabilidad de costo, fuente y recargos
ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_costo NUMERIC(10,2);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS fuente_origen VARCHAR(50) DEFAULT 'kroser';
ALTER TABLE productos ADD COLUMN IF NOT EXISTS margen_aplicado NUMERIC(5,2);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS iva_aplicado NUMERIC(5,2);

CREATE INDEX IF NOT EXISTS idx_productos_fuente_origen ON productos(fuente_origen);

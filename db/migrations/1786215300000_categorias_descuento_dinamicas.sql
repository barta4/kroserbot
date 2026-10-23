-- Migration: 1786215300000_categorias_descuento_dinamicas.sql
-- Description: Gestión dinámica de categorías de descuento para Cotibot y Admin Panel

-- 1. Eliminar restricción rígida en clientes_usuarios para permitir cualquier categoría dinámica
ALTER TABLE clientes_usuarios DROP CONSTRAINT IF EXISTS clientes_usuarios_categoria_check;

-- 2. Crear tabla de categorías de descuento configurables
CREATE TABLE IF NOT EXISTS categorias_descuento (
  id                   SERIAL PRIMARY KEY,
  codigo               VARCHAR(50) UNIQUE NOT NULL,
  nombre               VARCHAR(100) NOT NULL,
  descuento_porcentaje NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  orden                INT NOT NULL DEFAULT 0,
  activo               BOOLEAN NOT NULL DEFAULT TRUE,
  descripcion          TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categorias_descuento_codigo ON categorias_descuento(codigo);
CREATE INDEX IF NOT EXISTS idx_categorias_descuento_activo ON categorias_descuento(activo);
CREATE INDEX IF NOT EXISTS idx_categorias_descuento_orden ON categorias_descuento(orden);

-- 3. Poblar las categorías base iniciales con sus descuentos estándar
INSERT INTO categorias_descuento (codigo, nombre, descuento_porcentaje, orden, activo, descripcion)
VALUES
  ('minorista', 'Minorista', 0.00, 1, TRUE, 'Consumidor final estándar sin descuento por defecto'),
  ('profesional', 'Profesional', 10.00, 2, TRUE, 'Técnicos, electricistas y sanitarios independientes'),
  ('gremio', 'Gremio', 15.00, 3, TRUE, 'Talleres y miembros de asociaciones o gremios del rubro'),
  ('empresa', 'Empresa', 20.00, 4, TRUE, 'Empresas constructoras y cuentas corporativas'),
  ('mayorista', 'Mayorista', 25.00, 5, TRUE, 'Grandes distribuidores y compras de gran volumen')
ON CONFLICT (codigo) DO UPDATE
SET
  nombre = EXCLUDED.nombre,
  descuento_porcentaje = EXCLUDED.descuento_porcentaje,
  orden = EXCLUDED.orden;

-- Migration: 1786215200000_promocion_productos_control_total.sql
-- Control total de promociones y asignación manual de productos específicos

-- 1. Agregar columna para SKUs directos en promociones_especiales
ALTER TABLE promociones_especiales 
ADD COLUMN IF NOT EXISTS productos_skus TEXT[] DEFAULT '{}';

-- 2. Tabla de relación explícita entre promociones y productos
CREATE TABLE IF NOT EXISTS promocion_productos (
    promocion_id INT NOT NULL REFERENCES promociones_especiales(id) ON DELETE CASCADE,
    producto_id INT NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    descuento_override NUMERIC(5,2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (promocion_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_promocion_productos_prod ON promocion_productos(producto_id);
CREATE INDEX IF NOT EXISTS idx_promocion_productos_promo ON promocion_productos(promocion_id);

-- 3. Asignar los productos Equus a la promoción 1 por defecto
INSERT INTO promocion_productos (promocion_id, producto_id)
SELECT 1, p.id
FROM productos p
WHERE p.fuente_origen = 'equus'
ON CONFLICT DO NOTHING;

-- Sincronizar array de SKUs en promocion 1
UPDATE promociones_especiales pe
SET productos_skus = ARRAY(
    SELECT p.sku 
    FROM promocion_productos pp
    JOIN productos p ON p.id = pp.producto_id
    WHERE pp.promocion_id = pe.id
)
WHERE pe.id = 1;

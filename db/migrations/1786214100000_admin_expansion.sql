-- Migration: 1786214100000_admin_expansion.sql
-- Description: Tablas y campos adicionales para expansión del panel admin:
--   - Zonas de envío (departamento, barrio/zona, costo)
--   - Formas de pago (nombre, descripción, instrucciones)
--   - Campos adicionales en pedidos (notas, motivo_modificacion, zona_envio_id, forma_pago_id, costo_envio)
--   - Claves iniciales en configuracion

-- Tabla: zonas_envio
CREATE TABLE IF NOT EXISTS zonas_envio (
  id                  SERIAL PRIMARY KEY,
  departamento_ciudad VARCHAR(100) NOT NULL DEFAULT 'Montevideo',
  barrio_zona         VARCHAR(150) NOT NULL,
  costo_envio         NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  activo              BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla: formas_pago
CREATE TABLE IF NOT EXISTS formas_pago (
  id            SERIAL PRIMARY KEY,
  nombre        VARCHAR(100) NOT NULL,
  descripcion   TEXT,
  instrucciones TEXT,
  activo        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Columnas adicionales en pedidos
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS notas TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS motivo_modificacion TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS zona_envio_id INTEGER REFERENCES zonas_envio(id) ON DELETE SET NULL;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS forma_pago_id INTEGER REFERENCES formas_pago(id) ON DELETE SET NULL;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS costo_envio NUMERIC(10,2) DEFAULT 0.00;

-- Claves iniciales de configuración
INSERT INTO configuracion (key, value) VALUES
  ('chatwoot_base_url', ''),
  ('chatwoot_api_token', ''),
  ('aviso_email_pedido', 'pedidos@kroser.com.uy'),
  ('aviso_telefono_pedido', '+59899123456'),
  ('fuente_datos', 'scraping'),
  ('sql_directo_url', ''),
  ('api_productos_url', ''),
  ('api_productos_key', '')
ON CONFLICT (key) DO NOTHING;

-- Seed inicial de Zonas de Envío
INSERT INTO zonas_envio (departamento_ciudad, barrio_zona, costo_envio) VALUES
  ('Montevideo', 'Pocitos / Punta Carretas', 180.00),
  ('Montevideo', 'Centro / Cordón / Ciudad Vieja', 150.00),
  ('Montevideo', 'Carrasco / Portones / Malvín', 220.00),
  ('Canelones', 'Ciudad de la Costa (Hasta Peaje)', 250.00),
  ('Interior', 'Envío por Agencia DAC / Mirtrans (A pagar en destino)', 0.00)
ON CONFLICT DO NOTHING;

-- Seed inicial de Formas de Pago
INSERT INTO formas_pago (nombre, descripcion, instrucciones) VALUES
  ('Efectivo contra entrega', 'Pago en efectivo al recibir el pedido en el domicilio o sucursal.', 'Tener el importe exacto o indicar cambio necesario.'),
  ('Transferencia Bancaria', 'Transferencia directa a cuenta BROU o Itaú.', 'Enviar comprobante de pago por WhatsApp o al email avisos.'),
  ('POS Móvil (Débito/Crédito)', 'Pago con tarjeta al momento de la entrega.', 'Se lleva posmóvil. Acepta Oca, Visa, Master, Creditel.')
ON CONFLICT DO NOTHING;

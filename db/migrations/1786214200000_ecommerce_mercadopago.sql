-- Migration: 1786214200000_ecommerce_mercadopago.sql
-- Description: Campos para pedidos e-commerce y configuración MercadoPago

-- Nuevos campos en pedidos
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS origen VARCHAR(50) DEFAULT 'bot';
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pago_estado VARCHAR(50) DEFAULT 'sin_pago';
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pago_referencia VARCHAR(255);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS ecommerce_order_number VARCHAR(100);

-- Actualizar constraint de estado para incluir 'en_preparacion'
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_estado_check;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_estado_check
  CHECK (estado IN ('pendiente','confirmado','en_preparacion','rechazado','cancelado','entregado'));

-- Nuevas claves de configuración
INSERT INTO configuracion (key, value) VALUES
  ('mercadopago_enabled', 'false'),
  ('mercadopago_access_token', ''),
  ('mercadopago_public_key', ''),
  ('mercadopago_webhook_secret', ''),
  ('ecommerce_auto_confirm_paid', 'true'),
  ('ecommerce_inbox_identifier', 'ecommerce')
ON CONFLICT (key) DO NOTHING;

-- Migration: 1786215500000_kroser_martinez_locales.sql
-- Description: Kroser Martínez pasa de 5 locales heredados a 2 puntos en Av. 8 de Octubre (La Unión, Montevideo)

-- 1. Reemplazar el maestro de locales por los 2 puntos reales.
--    La barraca (3451) y el local (3452) comparten teléfonos y horarios.
DELETE FROM locales;

INSERT INTO locales (nombre, zona, direccion, telefono, horario)
VALUES
  (
    'Kroser Martínez — Local 8 de Octubre 3452',
    'La Unión, Montevideo',
    'Av. 8 de Octubre 3452',
    '2508 3100 / 2509 7508',
    'Lunes a Viernes 08:00 a 18:00 hs · Sábados 08:00 a 14:00 hs · Domingos cerrado · WhatsApp 094 985 189 / 095 141 194'
  ),
  (
    'Kroser Martínez — Barraca 8 de Octubre 3451',
    'La Unión, Montevideo',
    'Av. 8 de Octubre 3451',
    '2508 3100 / 2509 7508',
    'Lunes a Viernes 08:00 a 18:00 hs · Sábados 08:00 a 14:00 hs · Domingos cerrado · WhatsApp 094 985 189 / 095 141 194'
  );

-- 2. Horarios comerciales del bot (hora Uruguay, UTC-3).
INSERT INTO configuracion (key, value)
VALUES
  ('business_hours_weekday_start', '08:00'),
  ('business_hours_weekday_end', '18:00'),
  ('business_hours_saturday_enabled', 'true'),
  ('business_hours_saturday_start', '08:00'),
  ('business_hours_saturday_end', '14:00')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = NOW();

-- 3. Identidad del asistente: solo se actualiza si conserva el texto heredado.
UPDATE configuracion
SET value = 'Sos el asistente virtual de Kroser Martínez, ferretería en La Unión, Montevideo (Av. 8 de Octubre 3452 y barraca 3451). Tu objetivo es ayudar a los clientes a encontrar productos del catálogo, responder consultas sobre locales, precios y envíos, y asistir en la toma de pedidos.',
    updated_at = NOW()
WHERE key = 'system_prompt'
  AND value LIKE '%Kroser Uruguay%';

-- Migration: 1723140002000_seed_configuracion.sql
-- Description: Seed base configuration and default stores (locales)

INSERT INTO configuracion (key, value) VALUES
  ('system_prompt', 'Sos el asistente virtual de Kroser Uruguay. Tu objetivo es ayudar a los clientes a encontrar productos del catálogo, responder consultas sobre sucursales, precios y envíos, y asistir en la toma de pedidos.'),
  ('msg_pedido_pendiente', 'Tu pedido pasó a revisión humana. En breve te confirmamos el estado y la disponibilidad.'),
  ('msg_pedido_listo', '¡Tu pedido fue confirmado! Nos comunicaremos a la brevedad para coordinar la entrega o retiro en local.'),
  ('msg_pedido_rechazado', 'Lamentamos informarte que no pudimos procesar tu pedido por falta de stock. Un asesor te contactará para ofrecerte alternativas.'),
  ('msg_derivacion', 'Te estoy derivando con un asesor humano para brindarte una atención personalizada. Por favor aguarda un momento.')
ON CONFLICT (key) DO NOTHING;

-- Seed inicial de locales Kroser en Uruguay
INSERT INTO locales (nombre, zona, direccion, telefono, horario) VALUES
  ('Kroser Portones', 'Portones', 'Av. Italia 5775 (Portones Shopping)', '2601 0000', 'Lunes a Domingo 10:00 a 22:00'),
  ('Kroser Centro', 'Centro', 'Av. 18 de Julio 1234', '2900 1122', 'Lunes a Viernes 09:00 a 19:00, Sábados 09:00 a 13:00'),
  ('Kroser Pocitos', 'Pocitos', 'Av. Brasil 2500', '2708 3344', 'Lunes a Viernes 09:00 a 19:30, Sábados 09:00 a 14:00'),
  ('Kroser Carrasco', 'Carrasco', 'Av. Arocena 1580', '2600 5566', 'Lunes a Sábados 10:00 a 20:00'),
  ('Kroser Ciudad de la Costa', 'Ciudad de la Costa', 'Av. Giannattasio km 21', '2682 7788', 'Lunes a Sábados 09:00 a 20:00')
ON CONFLICT DO NOTHING;

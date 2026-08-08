# Tarea 05 — Módulo de pedidos

## Objetivo
Que el bot pueda tomar un pedido, avisar al cliente y al operador, y que el operador lo pueda confirmar o rechazar desde el panel.

## Tareas
- [ ] Cuando el bot detecta intención de compra, arma un "carrito" en memoria (producto + cantidad)
- [ ] Pide los datos faltantes (nombre, ciudad/zona, forma de entrega)
- [ ] Máquina de estados explícita: `pendiente → confirmado | rechazado | cancelado → entregado` — transiciones inválidas se rechazan (ej. no confirmar algo ya cancelado)
- [ ] Guarda el pedido en `pedidos` con estado `pendiente`, incluyendo `conversation_id` y `account_id` (para poder responderle después)
- [ ] Al crear el pedido: mensaje fijo editable (`msg_pedido_pendiente`) — "Tu pedido pasó a revisión humana, en breve te confirmamos" — + notifica al área correspondiente
- [ ] Operador confirma desde el panel → mensaje fijo editable (`msg_pedido_listo`) al cliente vía Chatwoot + aviso a mail/teléfono
- [ ] Operador rechaza desde el panel (ej. sin stock) → mensaje fijo editable (`msg_pedido_rechazado`) al cliente
- [ ] Detección de cancelación: si el cliente escribe algo tipo "ya no lo quiero" mientras el pedido sigue `pendiente`, pasa a `cancelado` y avisa internamente
- [ ] Cada cambio de estado en una transacción DB + registro en `pedidos_historial` (quién, cuándo, de qué estado a cuál)
- [ ] Reintento si falla el envío de la notificación (mail o Chatwoot) — no perderla en silencio
- [ ] Job de seguimiento: pedidos `pendiente` hace más de X horas → alerta interna

## Criterio de terminado
Un pedido de prueba recorre todo el ciclo (creado → confirmado, y por separado creado → rechazado, y creado → cancelado por el cliente) y en cada paso el mensaje correcto llega a quien corresponde.

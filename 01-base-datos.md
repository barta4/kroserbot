# Tarea 01 — Base de datos

## Objetivo
Modelar el schema completo en Postgres con pgvector, con migraciones versionadas (nunca editar el schema a mano en producción).

## Tareas
- [ ] Elegir herramienta de migraciones (Prisma, node-pg-migrate o Alembic)
- [ ] Tabla `productos`: id, sku (unique), nombre, precio, precio_oferta, marca, categoria, descripcion, imagen_url, producto_url, stock_status, embedding (vector), discontinuado (bool), updated_at
- [ ] Tabla `configuracion`: key (unique), value (text), updated_at — acá viven el system_prompt y los mensajes fijos (msg_pedido_pendiente, msg_pedido_listo, msg_pedido_rechazado, msg_derivacion)
- [ ] Tabla `locales`: id, nombre, zona, direccion, telefono, horario
- [ ] Tabla `pedidos`: id, conversation_id, account_id, cliente (jsonb), items (jsonb), estado (pendiente/confirmado/rechazado/cancelado/entregado), created_at, updated_at
- [ ] Tabla `pedidos_historial` (auditoría): pedido_id, estado_anterior, estado_nuevo, cambiado_por, created_at
- [ ] Tabla `conversaciones` (opcional): log de mensajes si quieren histórico fuera de Redis
- [ ] Tabla `scraper_runs`: id, status (running/stopped/completed/failed), started_at, finished_at, pagina_actual, productos_nuevos, productos_actualizados, stop_requested (bool)
- [ ] Constraints: NOT NULL donde corresponda, FOREIGN KEY conversación→pedido, UNIQUE en sku
- [ ] Índice vectorial (hnsw) sobre `productos.embedding`, índice normal sobre sku y categoria
- [ ] Seed inicial de `configuracion` (system_prompt base + mensajes fijos) para no arrancar con la tabla vacía
- [ ] Script de backup automatizado (pg_dump diario)

## Criterio de terminado
Migraciones corren de cero a esquema completo con un solo comando, y hay al menos un backup de prueba restaurado exitosamente.

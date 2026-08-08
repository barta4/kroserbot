# Alcance del Proyecto — Bot Kroser (RAG + Pedidos)

Migración del workflow n8n actual a una aplicación propia: scraper de catálogo + RAG en Postgres + backend que reemplaza el flujo + panel para editar el prompt y ver pedidos.

**Stack propuesto:** Python (scraper), Node.js/Express o FastAPI (backend), Postgres + pgvector, Redis (memoria, ya lo usan), Next.js (panel admin), Docker Compose para levantar todo.

---

## FASE 0 — Setup base
- [ ] Repo con estructura de carpetas: `/scraper`, `/backend`, `/admin`, `/db`
- [ ] Docker Compose: Postgres (con extensión pgvector), Redis
- [ ] Variables de entorno (.env): claves LLM, credenciales Chatwoot, DB, Redis

## FASE 1 — Base de datos
- [ ] Tabla `productos`: id, sku, nombre, precio, precio_oferta, marca, categoria, descripcion, imagen_url, producto_url, stock_status, embedding (vector), updated_at
- [ ] Tabla `configuracion`: key/value → acá vive el `system_prompt` editable y reglas (envíos, crédito, mails de derivación)
- [ ] Tabla `pedidos`: id, conversation_id, cliente (jsonb), items (jsonb), estado, created_at
- [ ] Tabla `conversaciones` (opcional, log de mensajes por si quieren histórico fuera de Redis)
- [ ] Tabla `locales`: nombre, zona/ciudad (Portones, Geant, Carrasco, Centro, Pocitos, Buceo, Colón, Cerro, Ciudad de la Costa, Maldonado, Pando, Las Piedras), dirección, teléfono, horario
- [ ] Índice vectorial (ivfflat o hnsw) sobre `productos.embedding`

## FASE 2 — Scraper Kroser (Fenicio)
- [ ] Sesión con cookies (request previo a home) + headers de navegador real
- [ ] Intentar primero `sitemap.xml` → `sitemap-products.xml` para listar URLs de producto directo
- [ ] Fallback: paginación `/catalogo?page=N` parseando HTML (BeautifulSoup)
- [ ] Extracción por producto: nombre, precio, marca, sku, imagen, url, categoría, stock_status
- [ ] Rate limiting: delay ~8s entre requests, con jitter aleatorio (no fijo, para no parecer bot)
- [ ] Reintentos con backoff si hay 403/429
- [ ] Upsert en tabla `productos` (por sku), detectar productos discontinuados
- [ ] Log de corrida (cuántos nuevos, cuántos actualizados, errores)

## FASE 3 — Pipeline de Embeddings (RAG)
- [ ] Script que toma productos nuevos/modificados y genera embedding (texto: nombre + categoría + descripción)
- [ ] Guardar embedding en la columna vector
- [ ] Job programado (cron) que corre scraper + embeddings, ej. 1 vez por día
- [ ] Función de búsqueda semántica: dado un mensaje del cliente, devolver top-N productos relevantes

## FASE 4 — Backend (reemplaza el workflow de n8n)
- [ ] Endpoint webhook (recibe eventos de Chatwoot, misma auth básica que tenían)
- [ ] Escudo de eventos: ignorar mensajes que no sean `message_created` y los que sean del propio bot (evita bucle infinito)
- [ ] Filtro de rebote de mail (bounce/mailer-daemon) — no responder a esos
- [ ] Debounce: agrupar mensajes que llegan seguidos (~8s de espera) antes de procesar, igual que el "Espera 8 S" actual
- [ ] Normalización de mensaje (texto/audio/imagen — igual que el flujo actual con Gemini)
- [ ] Búsqueda RAG según el mensaje del cliente
- [ ] Armado del prompt: `system_prompt` (desde `configuracion`) + contexto de productos y locales encontrados
- [ ] Llamada al LLM (Gemini/OpenAI, con fallback como tenían)
- [ ] Memoria de conversación en Redis (mismo esquema: session key = conversation_id, TTL, contextWindow)
- [ ] Detección de intención de compra → dispara módulo de pedidos
- [ ] Escalación a humano: si el LLM responde con patrón `DERIVAR...`, asignar la conversación a un agente en Chatwoot (assignee configurable, no hardcodeado), enviar mensaje fijo al cliente y avisar por mail interno (nombre, teléfono, canal) — distinto del aviso de pedido
- [ ] Envío de respuesta a Chatwoot (mismo endpoint que ya usan)
- [ ] Lógica de derivación a mail según área (ecommerce, rrhh, administración, franquicias, info) — igual que el prompt actual

## FASE 5 — Módulo de pedidos
- [ ] Cuando el bot detecta intención de compra, arma un "carrito" en memoria (producto + cantidad)
- [ ] Pide datos faltantes (nombre, ciudad/zona, forma de entrega)
- [ ] Guarda el pedido en tabla `pedidos` con estado `pendiente` (incluye conversation_id y account_id para poder responderle después)
- [ ] Al crear el pedido, envía mensaje fijo editable (`msg_pedido_pendiente`): "Tu pedido pasó a revisión humana, en breve te confirmamos" + notifica al área correspondiente
- [ ] Operador marca el pedido como "listo/confirmado" desde el panel → dispara mensaje fijo editable (`msg_pedido_listo`) al cliente vía Chatwoot (usando el conversation_id guardado) y aviso a mail/teléfono según corresponda
- [ ] Operador puede "rechazar" el pedido (ej. sin stock) → dispara mensaje fijo editable (`msg_pedido_rechazado`) al cliente
- [ ] Detección de cancelación: si el cliente escribe algo tipo "ya no lo quiero" mientras el pedido sigue `pendiente`, el bot lo pasa a estado `cancelado` y avisa internamente (evita que el operador confirme algo que ya no corresponde)
- [ ] Seguimiento: si un pedido queda `pendiente` más de X horas, recordatorio automático al cliente o aviso interno (evita perder ventas)

## FASE 6 — Panel Admin
- [ ] Login básico
- [ ] Editor del `system_prompt` (textarea, guarda en `configuracion`)
- [ ] Vista de catálogo scrapeado (buscar/filtrar productos)
- [ ] Vista de pedidos (lista, estado, marcar como atendido)
- [ ] Ventana "Pedidos": tabla filtrable por estado (pendiente/listo/rechazado/cancelado/entregado), con botones "Confirmar" y "Rechazar" que disparan el aviso correspondiente al cliente (Chatwoot) y/o al área (mail)
- [ ] Gestión de `locales` (CRUD de direcciones/horarios/teléfonos)
- [ ] Botón para disparar scraping manual + ver estado de la última corrida
- [ ] Dashboard básico: pedidos por día, derivaciones a humano, productos más consultados

## FASE 7 — Deploy
- [ ] Dockerizar backend, admin y scraper
- [ ] Docker Compose completo (o separado por servicio si van a distintos servidores)
- [ ] Documentar variables de entorno necesarias

## FASE 8 — Observabilidad y mantenimiento
- [ ] Logs centralizados (backend, scraper) con nivel de error visible
- [ ] Backups automáticos de Postgres (diarios)
- [ ] Alerta si el scraper falla o si el bot deja de responder
- [ ] Tests básicos: búsqueda RAG, armado de pedido, webhook (mock de Chatwoot)
- [ ] Manejo seguro de datos sensibles del cliente (cédula, fecha de nacimiento para crédito) — no loguear en texto plano

---

Con esto en mano, la idea es ir fase por fase con Claude Code: primero FASE 0 y 1 (esqueleto + DB), después el scraper, y así siguiendo — sin saltar pasos.

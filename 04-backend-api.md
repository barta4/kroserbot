# Tarea 04 — Backend (reemplaza el workflow de n8n)

## Objetivo
El servicio que recibe los mensajes de Chatwoot, arma el contexto (RAG + prompt editable), llama al LLM y responde — reemplazando 1 a 1 el workflow actual de n8n.

## Tareas
- [ ] Arquitectura en capas: routes → controllers → services → repositories (nada de lógica de negocio en el route handler)
- [ ] Webhook con verificación de auth (basic auth, igual que tenían) — rechaza requests no autenticados
- [ ] Idempotencia: dedup por `message_id` (si Chatwoot reenvía el mismo evento, no procesarlo dos veces)
- [ ] Escudo de eventos: ignorar todo lo que no sea `message_created`
- [ ] Filtro de mensajes salientes (no reprocesar los mensajes que el propio bot mandó — evita loop infinito)
- [ ] Filtro de rebote de mail (bounce/mailer-daemon)
- [ ] Debounce: agrupar mensajes que llegan seguidos (~8s) antes de mandar al LLM
- [ ] Normalización de mensaje (texto/audio/imagen, igual que el flujo actual con Gemini)
- [ ] Búsqueda RAG (tarea 03) según el mensaje del cliente
- [ ] Armado del prompt: `system_prompt` desde `configuracion` + contexto de productos y locales encontrados
- [ ] Llamada al LLM con fallback (Gemini primero, si falla cae a OpenAI) y timeout configurado
- [ ] Memoria de conversación en Redis (mismo esquema: session key = conversation_id, TTL, contextWindow)
- [ ] Detección de intención de compra → dispara módulo de pedidos (tarea 05)
- [ ] Escalación a humano: si el LLM responde con patrón `DERIVAR...` → asigna la conversación a un agente en Chatwoot (assignee configurable desde `configuracion`, no hardcodeado), manda mensaje fijo al cliente, avisa por mail interno
- [ ] Envío de respuesta a Chatwoot (mismo endpoint que ya usan)
- [ ] Derivación a mail según área (ecommerce, rrhh, administración, franquicias, info)
- [ ] Validación de input del webhook con un schema (rechazar payloads mal formados)
- [ ] Manejo de errores centralizado (middleware) — un error no debe tumbar el proceso
- [ ] Rate limiting en los endpoints propios
- [ ] Logging estructurado con correlation id por conversación
- [ ] Endpoint `/health`
- [ ] Endpoints del scraper: `POST /scraper/start`, `POST /scraper/stop`, `GET /scraper/status` (ver tarea 02)
- [ ] Tests de integración del flujo webhook → respuesta, con mocks de Chatwoot y del LLM

## Criterio de terminado
Un mensaje de prueba mandado al webhook produce la misma respuesta (en estructura y comportamiento) que producía el workflow de n8n, incluyendo escalación a humano y derivación por mail.

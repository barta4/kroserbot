---
name: kroserbot
description: Guía maestra de arquitectura, ciclo de vida del bot, conmutación Fail-Safe de IA, gestión de conversaciones en Chatwoot/Uruchat y mejores prácticas de desarrollo para el repositorio Kroserbot (cadena de ferreterías Kroser Uruguay). Activa este skill siempre que vayas a modificar, auditar, depurar, extender o probar cualquier componente de Kroserbot (backend Express, webhooks, base de datos pgvector, panel admin o scraper).
---

# Kroserbot — Guía Maestra del Sistema y Reglas de Desarrollo

Este skill define la arquitectura completa, ciclo de vida de mensajes, reglas de seguridad y estándares de código de **Kroserbot**, el sistema de IA y asistente omnicanal para **Kroser Uruguay** (ferretería, pinturas, herramientas y hogar).

---

## 🏛️ 1. Arquitectura General del Sistema

El stack tecnológico de Kroserbot consta de:
* **Backend API**: Node.js con Express.js (`backend/`), logging estructurado con Winston/custom logger (`backend/config/logger.js`).
* **Base de Datos Principal**: PostgreSQL 16 con extensión `pgvector` para búsqueda semántica vectorial de catálogo (`db/`).
* **Memoria & Debounce**: Redis (`backend/config/redis.js`) para control de concurrencia, buffers de debounce, bloqueo de bucles y memoria conversacional de 24h.
* **Integración Omnicanal**: **Uruchat** (instancia alojada de Chatwoot v1 en `https://app.uruchat.com`) conectada a WhatsApp Oficial, Instagram y Chat Web.
* **Motor LLM Multi-Proveedor con Fail-Safe**: Google Gemini (1.5/2.0) y OpenAI (GPT-4o/GPT-4o-mini) con *Function Calling*.
* **Panel Administrativo**: Interfaz web Vanilla HTML/CSS/JS (`admin/index.html`) con consola de simulación RAG, gestión de pedidos y control total de configuración.
* **Scraper & Ingestión**: Pipeline en Python (`scraper/`) para extracción nocturna desde `kroser.com.uy` e indexación de embeddings.

---

## 🛡️ 2. Regla Crítica de Rebranding: Uruchat vs. Chatwoot

> [!CAUTION]
> **REGLA DE ORO DE LA INTERFAZ**:
> En el panel de administración (`admin/index.html`) y en los manuales de usuario, **NUNCA utilices la palabra "Chatwoot" visible al usuario en títulos, etiquetas ni descripciones**.
> * La marca oficial de la plataforma en Uruguay es **Uruchat**.
> * El archivo de test `backend/tests/system_audit_improvements.test.js` audita esto de manera estricta y fallará si encuentra la palabra "Chatwoot" en el HTML.
> * En el código interno (archivos JS, nombres de variables como `chatwootService`, rutas de API como `/api/webhook/chatwoot`), el nombre técnico se preserva para compatibilidad con la API de Chatwoot.

---

## 🔄 3. Ciclo de Vida del Mensaje y Webhook (`webhookService.js`)

Cualquier agente que modifique [`backend/services/webhook/webhookService.js`](file:///c:/Users/usuario/Desktop/kroserbot/backend/services/webhook/webhookService.js) debe respetar la siguiente secuencia:

1. **Escudo de Tipos de Evento**: Solo procesar `message_created` con `message_type: 'incoming'` de usuarios finales. Ignorar mensajes salientes (`outgoing`) y de bots (`sender.type === 'bot'`) para prevenir bucles.
2. **Idempotencia Atómica**: Deduplicación obligatoria con `msg_processed:${messageId}` en Redis con `SET NX` (TTL 3600s).
3. **Intervención de Agentes Humanos**: Si un agente humano responde o la conversación se asigna a un humano:
   * Se guarda `human_active:${conversationId}` en Redis con TTL de 24h.
   * Se cancela el debounce y se cancela cualquier auto-cierre programado.
   * El bot se silencia por completo en esa conversación.
4. **Filtro de Inboxes Desactivados**: Comprobar `canales_desactivados`. Si la bandeja está apagada para el bot, no intervenir.
5. **Debounce Asíncrono**: Agrupación inteligente de fragmentos cortos (4 a 8 segundos) mediante `debounceService.js` antes de procesar con el LLM.
6. **Detector de Intenciones (`intentDetector.js`)**:
   * **Saludos puros (`isPureGreeting`)**: Respuesta inmediata cordial con saludo según hora en Uruguay (UTC-3).
   * **Despedidas puras (`isPureFarewell`)**: Respuesta formal de cierre e invocación instantánea a `autoResolveService.resolveImmediately(accountId, conversationId, 'farewell')`.
   * **Tracking de pedidos (`isTracking`)**: Extracción de identificador y consulta directa a `orderTrackingService.js`.
7. **Escudo Anti-Bucles (`botLoopDetector.js`)**:
   * Descarta respuestas automáticas de IVR o contestadores telefónicos.
   * Cuenta los turnos consecutivos del bot. Si supera `bot_max_turns_limit` (por defecto 15 turnos), pausa el bot y deriva a humano.
8. **Invocación al LLM con Herramientas**: Llama a `llmService.generateWithTools`.
9. **Detección de Derivación (`DERIVAR:[area]`)**:
   * NUNCA cerrar la conversación si hay derivación.
   * Asignar al agente de área en Uruchat (`assignAgent`).
   * Enviar nota interna privada con resumen y plan de acción (`derivationNoteService.js`).
   * Enviar alerta por email interno (`emailService.js`).
10. **Envío y Auto-Cierre Programado**: Tras responder con éxito, programar el cierre por inactividad (`autoResolveService.scheduleAutoResolve`).

---

## 🤖 4. Motor LLM y Sistema Fail-Safe de Alta Disponibilidad

El módulo [`backend/services/llm/llmService.js`](file:///c:/Users/usuario/Desktop/kroserbot/backend/services/llm/llmService.js) cuenta con un mecanismo **Fail-Safe bidireccional**:

### Configuración Independiente de Modelos
El usuario puede elegir cualquier modelo tanto para el canal primario como para el de respaldo:
* **Primario**: `llm_provider` (`gemini`, `openai`, `compatible`), `llm_model` (ej. `gemini-1.5-flash`), `llm_api_key`.
* **Respaldo**: `llm_fallback_provider` (`openai`, `gemini`), `llm_fallback_model` (ej. `gpt-4o-mini`), `llm_fallback_api_key`.
* **Switch**: `llm_failsafe_enabled` (`true`/`false`).

### Protocolo de Conmutación
1. Si el proveedor primario falla (código `429` de cuota, error `500/503` de servidor o timeout de red):
   * Captura la excepción sin quebrar el flujo.
   * Registra una advertencia estructurada: `⚠️ [LLM Fail-Safe Activado] Proveedor primario falló...`
   * Si el Fail-Safe está activo, llama **de inmediato al proveedor de respaldo pasando su propio modelo y su propia clave API**.
2. **Preservación de Herramientas**: Tanto el primario como el respaldo tienen definidos esquemas de *Function Calling* idénticos (`buscar_productos`, `consultar_locales`, `consultar_pedido`, `registrar_pedido`, etc.).
3. **Contingencia Final**: Solo si ambos proveedores fallaran simultáneamente, se devuelve una respuesta heurística amable sin cortar el chat.

---

## 🧹 5. Cierre y Resolución de Conversaciones en Uruchat / Chatwoot

Implementado en [`backend/services/chatwoot/autoResolveService.js`](file:///c:/Users/usuario/Desktop/kroserbot/backend/services/chatwoot/autoResolveService.js):

* **Endpoint oficial**: `POST /api/v1/accounts/${accountId}/conversations/${conversationId}/toggle_status` con `{ status: "resolved" }`.
* **Etiquetado automático**: `POST /.../labels` con la etiqueta configurada (`resuelto-bot`).
* **Cuándo se resuelve**:
  1. Inmediatamente en despedidas explícitas (`isPureFarewell`).
  2. Tras lapso de inactividad configurable (`auto_resolve_timeout_minutes`, por defecto 15 min).
* **Cuándo NUNCA se resuelve**:
  * Si la conversación fue derivada a un humano (`DERIVAR:...`).
  * Si un agente humano intervino (`human_active` en Redis).
* **Reapertura transparente**: Si el cliente vuelve a escribir a una conversación resuelta, Uruchat la reabre a `open` automáticamente y despacha `message_created`.

---

## ⚙️ 6. Repositorio y Whitelist de Configuración

Todas las variables dinámicas del sistema se administran mediante [`backend/repositories/configuracionRepository.js`](file:///c:/Users/usuario/Desktop/kroserbot/backend/repositories/configuracionRepository.js) y se exponen en `/api/configuracion`.

> [!IMPORTANT]
> **Whitelist en el Controlador**:
> Cualquier nueva clave de configuración que deba guardarse desde el panel admin o API **DEBE estar registrada en `ALLOWED_EXACT_KEYS`** en [`backend/controllers/configuracionController.js`](file:///c:/Users/usuario/Desktop/kroserbot/backend/controllers/configuracionController.js). De lo contrario, la petición será rechazada con `400 Clave no permitida`.

---

## 🧪 7. Guía de Ejecución de Tests

Antes de dar por finalizada cualquier tarea o cambio, ejecuta los tests automatizados:

```bash
# Probar Fail-Safe de LLM y modelos
npx jest backend/tests/llm_failsafe.test.js

# Probar resolución de conversaciones en Uruchat / Chatwoot
npx jest backend/tests/chatwoot_auto_resolve.test.js

# Probar notas privadas de derivación
npx jest backend/tests/derivation_note.test.js

# Probar reglas de auditoría y no-regresión de rebranding (Uruchat)
npx jest backend/tests/system_audit_improvements.test.js

# Probar suite completa
npm test
```

---

## 🚢 8. Reglas de Despliegue (Docker Hub & Dokploy)

Si el usuario solicita compilar o desplegar nuevas imágenes:
1. Usar siempre el skill `docker-hub-automation` para usuario **`alfredobartaburu`**.
2. **Incrementar la versión semántica** (ej. `v2.4` $\rightarrow$ `v2.5`) para evitar que Dokploy / Easypanel use capas en caché.
3. Compilar con `--platform linux/amd64` y dual-taggear con `:latest`.

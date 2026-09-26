# Guía de Contexto y Reglas de Desarrollo para Agentes de IA — Kroserbot

Bienvenido al repositorio de **Kroserbot** (Versión actual: **v1.7.0**).  
Este documento define la arquitectura general, las reglas de oro del negocio, los patrones de código obligatorios y los flujos de prueba y despliegue que cualquier agente de IA o desarrollador humano debe respetar al modificar este codebase.

---

## 🏛️ 1. Arquitectura del Sistema

Kroserbot es la plataforma omnicanal de atención inteligente, recomendación técnica, búsqueda de catálogo y toma de pedidos de **Kroser Uruguay** (cadena nacional de ferreterías, pinturas, herramientas, sanitaria, electricidad y artículos para el hogar).

### Componentes Principales

| Componente | Directorio | Tecnología | Responsabilidad |
|---|---|---|---|
| **Backend API** | `backend/` | Node.js (v20) + Express.js | API REST, webhook receiver, orquestador de agentes, guardrails y seguridad. |
| **Base de Datos** | `db/` | PostgreSQL 16 + `pgvector` | Catálogo de productos, embeddings vectoriales (768d), sucursales, zonas de envío, pedidos y configuración. |
| **Memoria & Sesión** | `backend/config/redis.js` | Redis 7 (Alpine) | Buffer de debounce, control de concurrencia, bloqueo de bucles y memoria conversacional de 24h. |
| **Integración Omnicanal** | `backend/services/chatwoot/` | Uruchat / Chatwoot v1 API | Bandejas de WhatsApp Oficial, Instagram y Web. Enrutamiento y notas privadas a agentes humanos. |
| **Motor LLM con Fail-Safe** | `backend/services/llm/` | Google Gemini 1.5/2.0 & OpenAI GPT-4o | Function Calling de 7 herramientas, conmutación automática de alta disponibilidad y contingencia heurística. |
| **Panel de Administración** | `admin/` | Vanilla HTML5 / CSS3 / ES6 | Tablero operativo, visor de pedidos, gestión de business hours, simulador RAG y control de scraper. |
| **Scraper de Catálogo** | `scraper/` | Python 3.10 + BeautifulSoup4 + Async | Extracción automatizada desde `kroser.com.uy`, normalización de categorías e indexación de embeddings. |

---

## 🛡️ 2. Mandamientos Críticos del Código (Reglas Inquebrantables)

### 2.1 Regla de Rebranding: Uruchat vs. Chatwoot
> [!CAUTION]
> **NUNCA utilices la palabra "Chatwoot" visible al usuario en la interfaz web (`admin/index.html`), títulos, manuales ni mensajes de cara al cliente.**
> * La marca oficial en Uruguay es **Uruchat** (`https://app.uruchat.com`).
> * El test automatizado `backend/tests/system_audit_improvements.test.js` audita de manera estricta el HTML del panel admin y fallará si encuentra la palabra "Chatwoot".
> * En nombres técnicos de variables (`chatwootService`), rutas de API internas (`/api/webhook/chatwoot`) o endpoints de compatibilidad, el nombre técnico se preserva.

### 2.2 Seguridad y Claves de Cifrado (AES-256-GCM)
* **Prohibido el uso de fallbacks hardcodeados**: `backend/utils/cryptoUtils.js` exige obligatoriamente `ENCRYPTION_KEY` o `JWT_SECRET`. Si faltan, el sistema lanza una excepción fatal para evitar almacenar datos sensibles con claves predecibles.
* **Fuente única de claves sensibles**: Cualquier variable confidencial a cifrar en base de datos o enmascarar en la API debe declararse en [`backend/config/secretKeys.js`](backend/config/secretKeys.js).
* **Sanitización de errores**: La whitelist de configuración en [`configuracionController.js`](backend/controllers/configuracionController.js) rechaza claves inválidas con un mensaje genérico para no reflejar entradas del atacante.

### 2.3 Optimización de Consultas (No más N+1)
* Para obtener múltiples variables de configuración (por ejemplo, los horarios comerciales en webhooks o prompt builders), utiliza **siempre** `await configuracionRepo.getMultiple(['key1', 'key2', ...])` en lugar de llamadas individuales encadenadas.

### 2.4 Módulos Compartidos y DRY (Don't Repeat Yourself)
* **Venta Cruzada e Insumos**: Usa [`backend/utils/crossSellingMap.js`](backend/utils/crossSellingMap.js).
* **Formateo de Precios (UYU / USD / Ofertas)**: Usa [`backend/utils/formatCurrency.js`](backend/utils/formatCurrency.js).
* **Normalización de Texto (Sin tildes ni caracteres raros)**: Usa [`backend/utils/textNormalizer.js`](backend/utils/textNormalizer.js).

### 2.5 Ciclo de Vida del Webhook (`webhookService.js`)
1. **Filtro de eventos**: Solo procesar `message_created` entrantes (`incoming`). Ignorar `outgoing` y bots para evitar loops infinitos.
2. **Deduplicación atómica**: Control en Redis con clave `msg_processed:${messageId}` (TTL 3600s).
3. **Intervención humana**: Si existe `human_active:${conversationId}` en Redis, el bot se silencia al 100% y se cancelan debounce y auto-cierre.
4. **Debounce asíncrono**: Agrupación de mensajes ráfaga (4 a 8 segundos) mediante `debounceService.js`.
5. **Detección de Derivación (`DERIVAR:[area]`)**:
   - NUNCA auto-resolver una conversación si fue derivada a un humano.
   - Asignar agente en Uruchat, publicar nota interna privada (`derivationNoteService.js`) y enviar alerta por email.
6. **Auto-cierre**: Se ejecuta inmediatamente ante despedidas (`isPureFarewell`) o tras 15 minutos de inactividad (`autoResolveService.js`).

---

## 🤖 3. Motor LLM y Sistema Fail-Safe

El servicio [`backend/services/llm/llmService.js`](backend/services/llm/llmService.js) cuenta con redundancia bidireccional:
* **Proveedor Primario**: Configurable (`gemini` o `openai`), con su propio modelo y API Key.
* **Proveedor de Respaldo**: Conmuta automáticamente si el primario responde `429` (Rate limit), `500/503` o timeout.
* **Function Calling**: Esquemas idénticos para ambos proveedores (`buscar_productos`, `buscar_sucursales`, `buscar_envio`, `formas_pago`, `consultar_guia_tecnica`, `consultar_pedido`, `registrar_pedido`).
* **Contingencia Heurística**: Si ambos proveedores fallaran, la función `buildHeuristicFallback(userMessages)` genera una respuesta amable contextualizada en mostrador uruguayo sin cortar el chat.

---

## 🧪 4. Comandos de Pruebas y Verificación

Antes de dar por finalizada cualquier tarea o cambio, **todos** los tests deben pasar en verde:

```bash
# Ejecutar suite completa de backend (15 suites, 202 tests)
npm test

# Ejecutar tests del Scraper en Python (22 tests)
npm run test:python

# Ejecutar auditoría estricta de Uruchat y migraciones
npx jest backend/tests/system_audit_improvements.test.js

# Ejecutar tests específicos de Function Calling
npx jest backend/tests/tool_executor.test.js

# Ejecutar tests de Fail-Safe de LLM
npx jest backend/tests/llm_failsafe.test.js
```

---

## 🚢 5. Reglas de Despliegue (Docker Hub & Dokploy)

* **Usuario Docker Hub**: `alfredobartaburu`
* **Imagen Backend**: `alfredobartaburu/kroserbot:<VERSION>` y `alfredobartaburu/kroserbot:latest`
* **Arquitectura obligatoria**: `--platform linux/amd64`
* **Regla de Etiquetado Incremental**: Dokploy y Easypanel cachean imágenes localmente en el servidor. **Siempre incrementa la versión semántica** (ej. `v1.6` ➔ `v1.7`) al compilar nuevas imágenes.
* **Comando de Build y Push**:
  ```bash
  docker buildx build --platform linux/amd64 -t alfredobartaburu/kroserbot:v1.7 -t alfredobartaburu/kroserbot:latest . --push
  ```
* **Git**: Sincronizar siempre a la rama `main` en `https://github.com/barta4/kroserbot.git`.
* **Desarrollo local**: Mantener bind-mounts y claves dummy en `docker-compose.override.yml` (ignorado en `.gitignore` para no sobreescribir producción).

---

## 📂 6. Estructura de Directorios

```text
kroserbot/
├── .agents/                      # Skills y configuraciones para agentes AI
│   └── skills/kroserbot/         # Skill maestro del proyecto
├── admin/                        # Panel administrativo (Vanilla HTML/CSS/JS)
│   ├── index.html                # Interfaz principal (Cumple regla de rebranding Uruchat)
│   ├── css/                      # Estilos del panel
│   └── js/                       # Controladores frontend del panel
├── backend/                      # API Express Node.js
│   ├── config/                   # Logger, PostgreSQL, Redis, secretKeys
│   ├── controllers/              # Controladores REST (auth, config, scraper, simulator)
│   ├── middleware/               # Auth, rate-limiting, error handler, MP webhook validator
│   ├── repositories/             # Capa de datos (productos, locales, pedidos, config)
│   ├── schemas/                  # Validación con Zod
│   ├── services/
│   │   ├── chatwoot/             # Uruchat API, auto-resolve, derivation notes
│   │   ├── customer/             # Memoria de clientes (Redis)
│   │   ├── ecommerce/            # Órdenes de e-commerce
│   │   ├── email/                # Nodemailer alertas de pedidos y derivaciones
│   │   ├── embeddings/           # Generación de vectores y RAG
│   │   ├── guardrails/           # Anti-abuso, anti-inyecciones y detector de bucles
│   │   ├── llm/                  # Motor LLM, Function Calling y Fail-Safe
│   │   ├── media/                # Audio transcribers y gestión de adjuntos
│   │   ├── pedidos/              # Lógica de pedidos y tracking
│   │   └── webhook/              # Webhook processor, debounce, intent detector, toolExecutor
│   ├── tests/                    # Suites de Jest (202 tests)
│   └── utils/                    # Criptografía, negocio, cross-selling, normalizadores
├── db/                           # Scripts de migración y backups
│   ├── migrations/               # Migraciones SQL incrementales
│   └── migrate.js                # Runner de migraciones hacia arriba y abajo
├── scraper/                      # Scraper en Python para catálogo Kroser
│   ├── tests/                    # Pruebas de Pytest (22 tests)
│   └── products.py               # Lógica de extracción y sanitización de datos
├── docker-compose.yml            # Compose endurecido para producción
├── docker-compose.dokploy.yml    # Configuración de despliegue Dokploy con Traefik
├── docker-compose.override.yml   # Overrides para desarrollo local (ignorado en Git)
├── Dockerfile                    # Multi-stage build no-root optimizado (Node 20 Alpine)
├── package.json                  # Dependencias y scripts del proyecto (v1.7.0)
└── README.md                     # Documentación de inicio rápido
```

---

*Última actualización de contexto: Release v1.7.0 (Auditoría Integral y Hardening de Producción).*

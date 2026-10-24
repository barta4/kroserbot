# Changelog — Kroserbot

Todos los cambios notables en este proyecto están documentados en este archivo.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/), y este proyecto adhiere a [Semantic Versioning](https://semver.org/spec/v2.0.4.html).

## [2.3.12] - 2026-10-24

### 💅 Pulido visual del composer de Cotibot
* Reemplazo del scrollbar nativo del textarea por uno fino (4 px), sin flechas y sólo visible cuando hace falta.
* Textarea autoexpandible hasta 132 px; el campo vacío ya no muestra scrollbar.
* Caja de entrada modernizada: fondo con degradado sutil, borde más limpio, foco amarillo y botón de envío más prolijo.
* Barra inferior con indicador verde y texto alineado a la izquierda.
* Píldora de “lista detectada · cotizando cada ítem” más compacta.
* Mismo tratamiento de scrollbar para el historial de mensajes.

### ✅ Verificación
* Suite completa: **36 suites / 463 tests** en verde.
* Revisión visual en 1440 px y 390 px, con campo vacío y listas largas.

---

## [2.3.11] - 2026-10-24

### ✂️ WhatsApp separado del resto de los canales
* Nueva política de canal (`channelPolicy`): WhatsApp responde en **1 solo mensaje, máximo 300 caracteres**, sin listas ni preguntas de seguimiento; web/Instagram mantienen respuestas más amplias.
* WhatsApp ignora `message_chunking_enabled` y nunca fragmenta la respuesta.
* Si `buscar_productos` devuelve 0, WhatsApp responde de forma determinista con dirección y teléfonos fijos (Av. 8 de Octubre 3452 — 2508 3100 / 2509 7508), sin segunda ronda del LLM. El texto se puede sobreescribir con `msg_sin_resultado_whatsapp`.
* Si el mensaje también consulta pagos, envíos, horarios o pedidos, se deja responder al LLM para no tapar esa consulta.

### 🎯 Precisión de búsqueda
* Normalización de **ñ** mediante `krosmart_unaccent` + migración de índices trigram. Antes, 27 productos con “CAÑO” eran invisibles al buscar “cano”.
* Matching tolerante a **nombres concatenados** (1.159 productos sin espacios) y sinónimos evaluados por frase completa.
* **Relajación progresiva** de atributos sólo en web; WhatsApp conserva coincidencia estricta.
* Penalización por **medida, potencia, volumen o color incompatible** y exigencia del sustantivo principal.
* Búsqueda por **prefijo** para que “caño” no pierda contra “americano”, y bonus por múltiples sustantivos núcleo.
* Umbral vectorial configurable con `search_vector_threshold`.

### 🧪 Evaluación y pruebas
* Nuevo `npm run search:eval` con set de 17 consultas reales: **15/15 hit@1 y hit@5** en web y **2/2 ausencias correctas**.
* Suite completa: **36 suites / 463 tests** en verde.

---

## [2.3.10] - 2026-10-24

### 🐛 Correcciones
* El compositor del chat ya no filtra el catálogo: al escribir o enviar un mensaje a Cotibot, la frase se guardaba en `AppState.searchQuery` y el catálogo quedaba vacío ("No encontramos artículos").
* Al iniciar una conversación se limpia cualquier búsqueda heredada y se recarga el catálogo completo.
* Se eliminó la detección de consultas conversacionales que ya no se utilizaba en el buscador del hero.

### ✅ Verificación
* Reproducido con API simulada: antes se consultaba `/api/productos?search=pintura+para+humedad` y el catálogo quedaba vacío; ahora solo se hace la consulta inicial sin `search` y las tarjetas permanecen visibles.
* Flujo de foco/minimizar del chat y sintaxis de los scripts verificados.

---

## [2.3.9] - 2026-10-23

### 🎨 Rediseño de la landing pública
* Nueva landing editorial en tema claro centrada en **Cotibot**: hero en dos columnas, sección "Cómo funciona", capacidades accionables, promociones vigentes, locales y footer renovado.
* **Modo foco del chat**: al iniciar una conversación el asistente pasa a un diálogo central con minimizar, cierre con Escape, trampa de foco y botón flotante para reabrirlo.
* Cabecera responsive con navegación por secciones, ingreso de clientes y presupuesto, sin desbordes entre 320 px y 1440 px.
* Imágenes optimizadas (`logo-krosmart-2x.png`, `logo-k-mark-96.png`) y favicon corregido.
* Accesibilidad: contraste AA, nombres accesibles, foco visible y tarjetas de promoción operables por teclado.
* Promociones dinámicas restauradas en el nuevo diseño y corrección del filtro por ID numérico en `applyPromoFilter`.

### ✅ Verificación
* Lighthouse: Accesibilidad **1.0**, Buenas prácticas **1.0**, SEO **1.0**, sin fallos.
* Layout validado en 320, 360, 390, 430, 640, 820 y 1440 px sin overflow horizontal.
* HTML balanceado y `node --check` OK en los scripts del cotizador.

---

## [2.3.8] - 2026-10-23

### 🔗 Panel de Control de la API Facturapp
* Nueva pestaña **API Facturapp & Créditos** en Catálogo & Logística del panel admin.
* Muestra plan, créditos disponibles, consumidos del mes, vigencia y estado de la clave.
* Última sincronización: último éxito, modo pendiente, `desdeId` y corte usado.
* Historial de corridas: páginas, artículos recibidos, insertados, actualizados, sin cambios, créditos consumidos y `requestId`.
* Acciones: estimar incremental/inicial y sincronizar; la inicial pide confirmación.
* La **API key no se expone ni se edita desde el navegador**: se configura en `FACTURAPP_API_KEY` del entorno del backend. El panel muestra el bloque de variables y el estado “Configurada/Sin clave”.

### ✅ Verificación
* Panel validado con respuestas simuladas (sin consumir créditos reales).
* Suite completa: **33 suites / 442 tests** en verde.
* Pytest: **24 tests** en verde.

---

## [2.3.7] - 2026-10-23

### 🏷️ Rebranding de despliegue: Krosmart
* Nombre comercial y de despliegue unificado como **Krosmart** (Kroser Martínez).
* Imágenes Docker oficiales: `alfredobartaburu/krosmart:v2.3.7` y `alfredobartaburu/krosmart:latest`.
* Imagen del scraper: `alfredobartaburu/krosmart-scraper:v1.5` (y alias `v1.0` de compatibilidad).
* Panel admin y manuales renombrados a **Krosmart AI 2.0**.
* Se conservan como nombres técnicos internos `kroserbot` para GitHub, base de datos, contenedores y volúmenes, evitando migraciones destructivas.
* `kroserbot:latest` se restauró a `v2.3.2` para no afectar el proyecto anterior.

### ✅ Verificación
* Suite completa: **33 suites / 442 tests** en verde.
* Pytest: **24 tests** en verde.

---

## [2.3.6] - 2026-10-23

### 🔀 Integración de `origin/main` (v2.3.0–v2.3.2)
* **Clasificador de búsqueda LLM** (`queryClassifier.js`) con modismos uruguayos y búsqueda multi-query.
* **Anti-falsos positivos** en catálogo y re-ranking, con fórmula de “no encontrado” y derivación a local.
* **Scraper v1.5**: SKUs alfanuméricos, detección de 404/410, precios de oferta y corrección del comando spawn.
* **Locales Kroser Martínez**: se conservan los 2 puntos de Av. 8 de Octubre, teléfonos, horarios, landing, prompt y migración de la v2.3.5.
* **Facturapp y landing modernizada** conservados e integrados con los cambios remotos.

### ✅ Verificación
* Suite completa: **33 suites / 442 tests** en verde.
* Pytest: **24 tests** en verde.
* Migraciones validadas.

---

## [2.3.5] - 2026-10-23

### 📍 Locales, teléfonos y horarios oficiales — Kroser Martínez
* **Solo 2 locales**: reemplazo de los 5 puntos heredados por **Av. 8 de Octubre 3452 (local)** y **3451 (barraca)**, La Unión, Montevideo.
* **Teléfonos oficiales**: `2508 3100 / 2509 7508` y WhatsApp `094 985 189 / 095 141 194` en landing, footer, prompt del bot, derivaciones y manuales.
* **Horarios**: Lunes a Viernes **08:00–18:00**, Sábados **08:00–14:00**, Domingos cerrado. Actualizados en configuración, admin y mensajes de fuera de horario.
* **Identidad**: el bot y la documentación pasan de “Kroser Uruguay” genérico a **Kroser Martínez**, con los 2 locales de La Unión.
* **Migración**: `1786215500000_kroser_martinez_locales.sql` reemplaza el maestro de locales y ajusta horarios/prompt.
* **Landing**: selector de retiro con 2 opciones, footer con locales/teléfonos/WhatsApp y JSON-LD con dirección y horarios.

### ✅ Verificación
* Suite completa: **31 suites / 423 tests** en verde.
* Pytest: **22 tests** en verde.
* Migraciones validadas.

---

## [2.3.4] - 2026-10-23

### 🎨 Landing del Cotizador — Modernización
* **Responsive real**: eliminación del overflow horizontal en móvil (390 px), navbar compacta con iconos y acciones de 44 px, hero y buscador reorganizados.
* **Nueva franja de valor**: 40 años, stock real, asesoramiento técnico y envío/retiro; refuerzo de confianza debajo del buscador.
* **Footer profesional**: catálogo, sucursales, contacto, Central de Reclamos y acceso a cuenta.
* **Iconografía SVG**: reemplazo de emojis por iconos consistentes en buscador, catálogo, drawer, checkout y estados vacíos.
* **Precios consistentes**: formato `es-UY` con separador de miles en tarjetas, cotización y resumen (`$ 4.390`).
* **Estados de carga y error**: spinner accesible, reintento y placeholders de imagen con identidad Kroser.
* **Accesibilidad**: contraste mejorado (texto secundario y enlaces azules), `aria-busy`, `aria-labels`, botones con `type`, foco visible y objetivos táctiles de 44 px.
* **SEO/social**: `theme-color`, Open Graph, Twitter Cards y JSON-LD de tienda.

### ✅ Verificación
* Suite completa: **31 suites / 423 tests** en verde.
* Sin overflow horizontal en 1440, 820 y 390 px; drawer y modales validados en ambos tamaños.

---

## [2.3.3] - 2026-10-23

### 🚀 Nuevas Funcionalidades
* **Sincronización de catálogo Facturapp**: integración con la API MCP (`articulos/listar`) mediante `facturapp_id` como clave estable de sincronización.
* **Sincronización inicial controlada**: cálculo de costo (`ceil(N/200)+1`), confirmación explícita y corte automático antes de agotar los créditos.
* **Incremental diaria**: `modificadosDesde = última sincronización exitosa - 1 día`, paginación por `siguienteDesdeId` y upsert idempotente.
* **Reanudación**: estado persistido por página (`pending_desde_id`), transacción por lote y actualización de `last_success_at` solo al completar.
* **Scheduler diario**: ejecución a las 04:00 hora Uruguay (`FACTURAPP_SYNC_ENABLED`), sin polling ni corridas duplicadas.
* **Panel de control por API**: `status`, `estimate` (sin costo), `sync` manual y `runs` con auditoría de créditos y `requestId`.
* **Preservación de datos**: `COALESCE` para no sobrescribir con nulos, baja por `activo:false` → `discontinuado`, y nunca se eliminan productos por ausencia en un incremental.

### 🛡️ Seguridad y Calidad
* Clave exclusivamente desde `FACTURAPP_API_KEY`, solo en backend y nunca en logs.
* Reintentos únicamente para 429/500/503; sin reintentos en 401/403/400/402.
* Lock Redis, detección de corridas stale y una sola solicitud activa por vez.
* 20 pruebas nuevas: páginas vacías, múltiples páginas, página parcial vs. llena, duplicados, errores, presupuesto y reanudación.
* Suite completa: **31 suites / 423 tests** en verde.

---

## [2.3.2] - 2026-10-23

### 🚀 Nuevas Funcionalidades
* **Cotizador Kroser Martínez (Canal Web)**: landing pública oficial para **Kroser Uruguay** con catálogo, carrito, checkout, chat con Cotibot (texto, audio e imagen), seguimiento de pedidos y pago con MercadoPago.
* **Cuentas de Cliente y Descuentos Dinámicos**: registro/login de clientes (`/api/auth/cliente`), categorías de descuento configurables (`categorias_descuento`) y cálculo de precios bonificados en servidor mediante `pricingCalculator.js`.
* **Pedidos Web Blindados**: recálculo obligatorio de precios desde catálogo, validación de stock y control de montos pagados en MercadoPago.
* **Promociones Especiales**: gestión completa de promociones y control total de productos promocionados desde el panel admin.
* **Multi-Scraper de Proveedores**: sincronización de proveedores externos (Equus) con prefijo de SKU, margen, IVA y moneda configurables (`multiScraperSyncService.js` + `scraequus/`).
* **Traductor Técnico de 3 Roles**: normalización de modismos ferreteros uruguayos a terminología de catálogo y detección de datos técnicos faltantes (`traductorTecnico.js`).
* **Panel Admin Modular**: separación de `admin/css/admin.css` y `admin/js/admin.js`; nuevas pestañas de Clientes, Promociones, Guías y Proveedores.

### 🛡️ Seguridad y Hardening (H1–H10 / S1–S6)
* Registro de clientes blindado contra autoasignación de categorías y descuentos.
* Precios recalculados desde catálogo en pedidos web y en `registrar_pedido` (anti-manipulación del LLM).
* Protección IDOR y sanitización de PII en el tracking de pedidos.
* Tokens de cliente rechazados en rutas administrativas; JWT restringido a `HS256`.
* Bloqueo SSRF en descarga de adjuntos y sanción de `precio_costo`/margen en la API pública.
* Comparaciones criptográficas en tiempo constante y validación HMAC de MercadoPago.
* Validación de entradas con Zod y rate limiting específico para chat y pedidos web.

### 🏗️ Arquitectura y Calidad
* Webhook modularizado en `webhookLifecycleHandler.js`, `webhookMediaHandler.js` y `webhookEscalationHandler.js`.
* `webhookService.js` reducido en ~471 líneas sin pérdida de funcionalidad.
* Suite Jest ampliada a **30 suites / 403 tests** y Pytest a **22 tests**, todos en verde.
* CI actualizado a Node 20 y ejecución de Jest + Pytest.

---

## [2.1.9] - 2026-10-06

### 🚀 Nuevas Funcionalidades
* **Fragmentación Conversacional Inteligente (Message Chunking)**:
  * Nuevo módulo `backend/utils/messageSplitter.js` que divide respuestas compuestas o extensas en 2 globos de chat naturales.
  * Preservación estricta de precios con punto de miles (`$2.490`), medidas (`1.5mm`) y enlaces web.
  * Eliminación de separadores horizontales markdown (`---`, `***`) transformándolos en quiebres limpios de párrafo.
* **Simulación de Tipeo Humano y Ritmo Dinámico**:
  * Pacing en `webhookService.js`: despacho del primer mensaje, activación del indicador de presencia "Escribiendo..." (`toggleTypingStatus`) durante 1.2s a 2.4s y despacho del segundo globo.
  * Blindaje defensivo contra errores de tipo (`TypeError`) ante respuestas vacías o filtradas por guardrails.
* **Reglas Anti-Testamento y Micro-copy de WhatsApp**:
  * Actualización en `promptBuilder.js`: límite estricto de 30 a 45 palabras por turno.
  * Prohibición terminante de párrafos extensos ("libros") y listados de fichas técnicas sin solicitud explícita del cliente.

### 🛡️ Calidad, Auditoría y Pruebas
* **Suite de Pruebas Automatizadas**:
  * Nueva suite `backend/tests/message_splitter.test.js` con 8 tests específicos.
  * Total de pruebas Jest: 24 suites, 314 tests en verde (100%).
  * Total de pruebas Pytest: 1 suite, 22 tests en verde (100%).
* **Contenedores y Despliegue**:
  * Imagen Docker compilada y publicada en Docker Hub: `alfredobartaburu/kroserbot:v2.1.9` y `alfredobartaburu/kroserbot:latest`.
  * Configuración sincronizada para Dokploy en `docker-compose.dokploy.yml`.

---

## [2.1.8] - 2026-10-06

### 🚀 Nuevas Funcionalidades
* **Búsqueda Híbrida Paralela de Alta Concurrencia (H1, H2, H4, H5)**:
  * Ejecución concurrente mediante `Promise.allSettled` entre búsqueda Full-Text (PostgreSQL trigramas + `tsvector`) y búsqueda semántica vectorial (`pgvector`).
  * Normalización dinámica Min-Max de puntajes y fusión mediante *Reciprocal Rank Fusion* (RRF).
  * Manejo resiliente de fallos individuales en motores de búsqueda (degradación suave a texto si vector falla o viceversa).
  * Penalización adaptativa para artículos agotados (`stock = 0`) para priorizar ítems con disponibilidad inmediata.
* **Control Integral de Embeddings desde el Panel Administrativo (E1, E2, E3, E4, E5)**:
  * Nuevos endpoints seguros de API: `GET /api/scraper/embeddings/status` y `POST /api/scraper/embeddings/generate`.
  * Tarjeta interactiva en la consola del Panel Admin (`admin/index.html`) con barra de progreso porcentual, conteo de productos vectorizados vs pendientes y botón de indexación manual asíncrona.
  * Disparador automático post-scraping: al finalizar con éxito el contenedor o proceso del scraper (exit code 0), el backend inicia automáticamente la indexación de embeddings pendientes en segundo plano.
  * Soporte unificado de dimensionalidad estricta (768d) tanto para Google Gemini (`text-embedding-004`) como OpenAI (`text-embedding-3-small` con truncado nativo a 768 dimensiones) para total compatibilidad con la columna `vector(768)`.
* **Desambiguación Semántica de Ferretería (H6, H8)**:
  * Prevención de falsos positivos en el detector de estado de pedidos (`orderTrackingService.js`) ante consultas técnicas de ferretería con patrones alfanuméricos cortos (ej. "taladro h6", "bujía h8", "llave m10", "puntera ph2").
  * Refuerzo en `intentDetector.js` para asegurar que las consultas sobre especificaciones mecánicas o herramientas sean canalizadas a búsqueda técnica o catálogo y no al rastreador de órdenes comerciales.

### 🛡️ Calidad, Auditoría y Seguridad
* **Auditoría Estricta de Rebranding Uruchat**: Cobertura continua en `system_audit_improvements.test.js` garantizando que no existan referencias públicas a "Chatwoot" en la interfaz administrativa ni mensajes de cara al cliente.
* **Pruebas Automatizadas**:
  * 23 suites de pruebas Jest y 306 tests unitarios/integración en verde (100%).
  * 22 pruebas Pytest para el extractor y sanitizador del Scraper en verde (100%).
* **Contenedores y Despliegue**:
  * Imagen oficial compilada para arquitectura `linux/amd64`: `alfredobartaburu/kroserbot:v2.1.8` y `alfredobartaburu/kroserbot:latest`.
  * Configuración sincronizada para Dokploy y Easypanel en `docker-compose.dokploy.yml` y `docker-compose.prod.yml`.

---

## [2.1.7] - 2026-10-05

### Agregado
* Conmutación Fail-Safe bidireccional entre Google Gemini y OpenAI GPT-4o.
* Transcripción de audios de WhatsApp en formatos `.opus` y `.oga` mediante Whisper y Gemini Audio.
* Visual Parts Finder para reconocimiento multimodal de repuestos y ferretería mediante imágenes Base64.
* Bloqueo atómico de bucles y control de debounce en Redis con clave `msg_processed:${messageId}`.

---

## [2.1.0] - 2026-09-20

### Agregado
* Integración con la API v1 de Uruchat (WhatsApp Oficial, Instagram y Web Widget).
* Módulo de tracking de pedidos y carritos de compras asistidos por bot.
* Soporte para checkout de Mercado Pago con validación de firma webhook HMAC.
* Panel administrativo inicial para gestión de prompts, horarios de sucursales y zonas de envío.

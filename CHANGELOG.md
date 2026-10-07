# Changelog — Kroserbot

Todos los cambios notables en este proyecto están documentados en este archivo.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/), y este proyecto adhiere a [Semantic Versioning](https://semver.org/spec/v2.0.4.html).

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

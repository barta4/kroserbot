# 📘 Manual de Funcionamiento del Sistema — Bot Kroser

**Plataforma Integral de Inteligencia Artificial para Kroser Uruguay**  
*Atención Omnicanal Automatizada • Catálogo Híbrido RAG (pgvector) • Herramientas Agénticas (Tool Calling) • Gestión de Pedidos y Depósito • Pasarela Mercado Pago • Ingestión de Catálogo (Scraper & ERP)*

---

## 📑 Tabla de Contenidos

1. [Ficha Técnica y Visión General del Sistema](#1-ficha-técnica-y-visión-general-del-sistema)
2. [Topología de Despliegue e Infraestructura](#2-topología-de-despliegue-e-infraestructura)
3. [Flujo de Entrada y Ciclo de Vida del Mensaje](#3-flujo-de-entrada-y-ciclo-de-vida-del-mensaje)
4. [Motor de Inteligencia Artificial y Razonamiento Agéntico (Tool Calling)](#4-motor-de-inteligencia-artificial-y-razonamiento-agéntico-tool-calling)
5. [Catálogo Vectorial y Búsqueda Híbrida RAG](#5-catálogo-vectorial-y-búsqueda-híbrida-rag)
6. [Sistema de Seguridad y Guardrails](#6-sistema-de-seguridad-y-guardrails)
7. [Protocolo de Derivación y Asignación Humana](#7-protocolo-de-derivación-y-asignación-humana)
8. [Módulo de Gestión de Pedidos y E-commerce](#8-módulo-de-gestión-de-pedidos-y-e-commerce)
9. [Integración con Mercado Pago](#9-integración-con-mercado-pago)
10. [Pipeline de Ingestión y Sincronización de Catálogo](#10-pipeline-de-ingestión-y-sincronización-de-catálogo)
11. [Manual de Operación del Panel de Administración y Depósito](#11-manual-de-operación-del-panel-de-administración-y-depósito)
12. [Mantenimiento, Observabilidad y Matriz de Troubleshooting](#12-mantenimiento-observabilidad-y-matriz-de-troubleshooting)

---

## 1. Ficha Técnica y Visión General del Sistema

El **Bot Kroser** es una solución enterprise desarrollada a medida para modernizar y escalar la atención a clientes, las ventas consultivas de ferretería y la gestión logística de pedidos para las más de 50 sucursales físicas y la tienda web de **Kroser Uruguay**. Reemplaza workflows heredados de n8n por una arquitectura robusta, modular y de baja latencia con agentes de IA autónomos.

### 1.1. Especificaciones Principales

| Componente | Tecnología | Rol en el Sistema |
| :--- | :--- | :--- |
| **Backend API** | Node.js 20+ / Express | Orquestador de eventos, lógica de negocio y APIs REST |
| **Base de Datos** | PostgreSQL 16 con `pgvector`, `pg_trgm`, `unaccent` | Almacenamiento relacional, histórico y búsqueda semántica de vectores |
| **Memoria & Caché** | Redis 7 Alpine | Debounce de mensajes, memoria de sesión de 24h, idempotencia y rate limiting |
| **Modelos de IA (LLM)** | Google Gemini (`1.5-flash`, `1.5-pro`, `2.0-flash`) / OpenAI (`gpt-4o-mini`, `gpt-4o`) | Razonamiento agéntico, llamada a herramientas (Function Calling) y respuestas contextualizadas |
| **Motor RAG** | Vectorial (Coseno 768 dim) + Trigramas + SKU exacto | Catálogo de ferretería, guías técnicas, sucursales y zonas de entrega |
| **Canales / CRM** | Uruchat / Chatwoot API | Recepción y envío omnicanal (WhatsApp, Instagram, Web Widget, Email) |
| **Ingestión de Datos** | Python 3.11+ (BeautifulSoup, Requests, Sitemap XML) | Scraper automatizado con checkpointing, importador SQL ERP y API REST |
| **Frontend Admin** | HTML5 / Vanilla JS / CSS Moderno | Panel administrativo completo (13 secciones) y terminal de preparación de depósito |

### 1.2. Diagrama de Arquitectura Global

```mermaid
flowchart TB
    subgraph Canales ["🌐 Canales Omnicanal"]
        WA["💬 WhatsApp"]
        IG["📸 Instagram"]
        WEB["🖥️ Web Widget"]
        MAIL["✉️ Email / E-commerce"]
    end

    subgraph UruchatCRM ["🔌 Plataforma Uruchat / Chatwoot"]
        CW_IN["Bandeja de Entrada Omnicanal"]
        CW_OUT["Envío de Mensajes & Notas Privadas"]
    end

    subgraph BackendCore ["⚙️ Backend Kroser (Node.js/Express)"]
        WH["/api/webhook Handler"]
        SHIELD["Escudo de Eventos & Idempotencia"]
        CHAN_CTRL["Control Granular de Canales"]
        DEBOUNCE["Debounce Buffer (4-8s)"]
        GUARD_IN["Guardrails Entrada (Abuso/Inyección)"]
        INTENT["Detector de Intenciones & Emociones"]
        MULTIMODAL["Media Service (Voz & Visión IA)"]
        AGENT_ROUTER["Orquestador Agéntico con Tool Calling"]
        PROMPT_BUILDER["Constructor Dinámico de Prompts"]
        GUARD_OUT["Guardrails Salida (Anti-Fugas)"]
        PEDIDOS_MOD["Módulo de Pedidos & Estado"]
        ECOMM_PARSER["Parser de Pedidos E-commerce"]
    end

    subgraph MemoryLayer ["⚡ Capa de Memoria & Caché"]
        REDIS[("Redis 7: Locks, Sesiones, Idempotencia")]
    end

    subgraph DataLayer ["🗄️ Base de Datos Relacional & Vectorial"]
        PG[("PostgreSQL 16\n- pgvector (Embeddings 768d)\n- pg_trgm (Fuzzy text)\n- unaccent (Sin tildes)\n- Tablas: productos, pedidos, locales, configuracion")]
    end

    subgraph LLMProviders ["🧠 Proveedores de Inteligencia Artificial"]
        GEMINI["Google Gemini API\n(1.5-flash / 1.5-pro / 2.0-flash)"]
        OPENAI["OpenAI / Compatibles\n(gpt-4o / gpt-4o-mini / Groq / Ollama)"]
    end

    subgraph ExternalIntegrations ["💳 Integraciones Externas"]
        MP["Mercado Pago Checkout Pro & Webhook"]
        SMTP["Servidor de Correo SMTP (Alertas Internas)"]
    end

    subgraph ScraperERP ["🕷️ Sincronización de Catálogo"]
        SCRAPER["Python Scraper (Sitemap + Fenicio)"]
        SQL_IMP["Conector SQL Directo ERP"]
        API_IMP["Conector API REST Externa"]
    end

    Canales --> CW_IN
    CW_IN -->|POST /api/webhook| WH
    WH --> SHIELD
    SHIELD --> CHAN_CTRL
    CHAN_CTRL -->|Si está activo| DEBOUNCE
    CHAN_CTRL -->|Si está apagado| CW_IN
    DEBOUNCE <--> REDIS
    DEBOUNCE --> GUARD_IN
    GUARD_IN --> INTENT
    WH --> MULTIMODAL
    MULTIMODAL --> AGENT_ROUTER
    INTENT --> AGENT_ROUTER
    AGENT_ROUTER --> PROMPT_BUILDER
    PROMPT_BUILDER <--> PG
    PROMPT_BUILDER <--> REDIS
    AGENT_ROUTER <--> LLMProviders
    AGENT_ROUTER -->|Function Calling: buscar_productos, etc.| PG
    AGENT_ROUTER --> GUARD_OUT
    GUARD_OUT --> CW_OUT
    AGENT_ROUTER --> PEDIDOS_MOD
    WH --> ECOMM_PARSER
    ECOMM_PARSER --> PEDIDOS_MOD
    PEDIDOS_MOD --> PG
    PEDIDOS_MOD --> MP
    PEDIDOS_MOD --> SMTP
    SCRAPER --> PG
    SQL_IMP --> PG
    API_IMP --> PG
```

---

## 2. Topología de Despliegue e Infraestructura

El sistema está completamente contenedorizado para permitir despliegues reproducibles tanto en entornos locales de desarrollo como en servidores VPS de producción (Dokploy, Portainer o Docker autónomo).

### 2.1. Mapa de Puertos y Servicios

| Contenedor | Imagen Base | Puerto Expuesto | Rol |
| :--- | :--- | :--- | :--- |
| `kroserbot-app` | `node:20-alpine` | `3000:3000` | Backend Express API, Cron Jobs y Panel Web (`/admin`, `/deposito`) |
| `kroserbot-postgres` | `pgvector/pgvector:pg16` | `5432:5432` | Motor de base de datos relacional y búsqueda vectorial |
| `kroserbot-redis` | `redis:7-alpine` | `6379:6379` | Memoria volátil, locks de debounce y sesiones de chat |
| `kroserbot-scraper` | `python:3.11-slim` | *Interno / CLI* | Servicio de extracción y actualización continua de catálogo |

### 2.2. Diccionario de Variables de Entorno (`.env`)

El archivo `.env` en la raíz del proyecto gobierna el comportamiento de todos los componentes:

```env
# ========================================================
# SERVIDOR Y AMBIENTE
# ========================================================
PORT=3000
NODE_ENV=production
CORS_ORIGINS=https://tu-dominio.com,http://localhost:3000

# ========================================================
# BASE DE DATOS (POSTGRESQL + PGVECTOR)
# ========================================================
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=kroser
POSTGRES_PASSWORD=tu_password_seguro_db
POSTGRES_DB=kroserbot
DATABASE_URL=postgresql://kroser:tu_password_seguro_db@postgres:5432/kroserbot

# ========================================================
# MEMORIA Y BUFFER (REDIS)
# ========================================================
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=

# ========================================================
# SEGURIDAD Y AUTENTICACIÓN PANEL ADMIN
# ========================================================
JWT_SECRET=clave_secreta_jwt_de_minimo_32_caracteres_aleatorios
ADMIN_USER=admin
ADMIN_PASSWORD=TuPasswordSuperSeguro2026!

# ========================================================
# INTEGRACIÓN URUCHAT / CHATWOOT
# ========================================================
CHATWOOT_BASE_URL=https://app.uruchat.com
CHATWOOT_API_TOKEN=tu_token_de_acceso_uruchat
CHATWOOT_BOT_AGENT_ID=                 # ID opcional del usuario bot en Chatwoot

# ========================================================
# PROVEEDORES DE INTELIGENCIA ARTIFICIAL (LLM)
# ========================================================
GEMINI_API_KEY=AIzaSy...               # Clave Google AI Studio para Gemini 1.5/2.0
OPENAI_API_KEY=sk-proj-...             # Clave OpenAI (o compatible)
OPENAI_BASE_URL=https://api.openai.com/v1  # Modificable para Groq/Ollama/DeepSeek

# ========================================================
# MERCADO PAGO (PAGOS ONLINE)
# ========================================================
MERCADOPAGO_ACCESS_TOKEN=APP_USR-...   # Token de producción o sandbox
MERCADOPAGO_WEBHOOK_SECRET=            # Secreto HMAC para validación x-signature
MERCADOPAGO_SUCCESS_URL=https://kroser.com.uy/compra-exitosa
MERCADOPAGO_FAILURE_URL=https://kroser.com.uy/compra-fallida
MERCADOPAGO_PENDING_URL=https://kroser.com.uy/compra-pendiente

# ========================================================
# NOTIFICACIONES SMTP (ALERTAS INTERNAS)
# ========================================================
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=notificaciones@kroser.com.uy
SMTP_PASS=tu_app_password
SMTP_FROM="Bot Kroser" <notificaciones@kroser.com.uy>
```

### 2.3. Comandos de Operación Docker

```bash
# Iniciar todos los servicios en segundo plano
docker compose up -d

# Ver estado de salud (healthcheck) de los contenedores
docker compose ps

# Inspeccionar logs en vivo del backend
docker compose logs -f backend

# Ejecutar migraciones pendientes de base de datos
docker compose exec backend npm run migrate:up

# Realizar un backup manual de Postgres
docker compose exec backend npm run db:backup
```

---

## 3. Flujo de Entrada y Ciclo de Vida del Mensaje

El procesamiento de mensajes en [`backend/services/webhook/webhookService.js`](file:///c:/Users/usuario/Desktop/kroserbot/backend/services/webhook/webhookService.js) sigue un estricto pipeline diseñado para garantizar consistencia, evitar bucles infinitos y respetar la atención humana.

```mermaid
sequenceDiagram
    autonumber
    actor Cliente as Cliente (WhatsApp/Web/IG)
    participant CW as Uruchat / Chatwoot
    participant WH as Webhook Core (Node.js)
    participant Redis as Redis (Memoria & Debounce)
    participant DB as Postgres (pgvector)
    participant LLM as Motor IA (Gemini/OpenAI)

    Cliente->>CW: Envía mensaje(s) ("Hola", "Precio taladro percutor")
    CW->>WH: POST /api/webhook (evento message_created)
    
    rect rgb(240, 245, 255)
    Note over WH,Redis: Fase 1: Escudo de Seguridad & Idempotencia
    WH->>Redis: Verifica msg_processed:<message_id> (Idempotencia)
    WH->>WH: Descarta mensajes salientes (outgoing) o de tipo 'bot'
    WH->>WH: Filtra rebotes de correo (mailer-daemon)
    WH->>DB: Consulta canales_desactivados (ej. Instagram)
    end

    rect rgb(255, 245, 240)
    Note over WH,Redis: Fase 2: Protocolo Humano & Debounce
    WH->>Redis: Verifica bandera human_active:<conv_id>
    WH->>Redis: Bloqueo conv_lock:<conv_id> (Ventana 4-8 seg)
    WH-->>Redis: Agrupa mensajes ráfaga en conv_buffer:<conv_id>
    end

    rect rgb(240, 255, 240)
    Note over WH,LLM: Fase 3: RAG Híbrido, Guardrails & Herramientas
    WH->>WH: Evaluación de Guardrails de entrada
    WH->>WH: Extracción multimodal (Voz / Fotos de repuestos)
    WH->>CW: Activa indicador de "Escribiendo..." (Typing on)
    WH->>LLM: Invocación inicial con System Prompt + Historial (20 msgs)
    LLM->>WH: Solicitud de Tool: buscar_productos("taladro percutor")
    WH->>DB: Búsqueda híbrida (Coseno + Trigramas + Cross-selling)
    DB-->>WH: 3 productos con precio, stock y kits sugeridos
    WH->>LLM: Respuesta de Tool (Turno 2)
    LLM-->>WH: Genera respuesta final consultiva
    end

    rect rgb(250, 250, 250)
    Note over WH,CW: Fase 4: Sanitización & Envío
    WH->>WH: Guardrails de salida (anti-fugas)
    WH->>WH: Simulación de delay de tipeo humano (15ms/carácter)
    WH->>CW: Desactiva indicador "Escribiendo..." (Typing off)
    WH->>CW: Envía respuesta final al cliente
    WH->>Redis: Guarda nuevo turno en historial conv_memory (TTL 24h)
    WH->>DB: Registra mensaje en tabla conversaciones
    end
```

### 3.1. Detalle de las Etapas del Webhook

1. **Idempotencia (TTL 1 Hora)**:
   - Almacena la clave `msg_processed:${messageId}` en Redis con un TTL de 3600 segundos. Si el webhook de Uruchat reintenta el envío por latencia de red, se descarta de forma transparente para no duplicar respuestas.

2. **Escudo Anti-Bucles (Event Shield)**:
   - Solo atiende el evento `message_created`.
   - Si `message.message_type === 'outgoing'` o el remitente tiene `sender.type === 'bot'`, se ignora inmediatamente para imposibilitar bucles infinitos.
   - Filtro de rebotes automáticos de correo: ignora cuerpos con `mailer-daemon`, `mail delivery failed` o `undelivered mail`.

3. **Control Granular de Canales e Inboxes (`isChannelDisabled`)**:
   - En la pestaña *Uruchat Integración* del panel admin se pueden suspender canales específicos (ej. Instagram, correo o un inbox numérico).
   - Si el canal coincide con la lista negra (`canales_desactivados`), el backend descarta el procesamiento del bot para que la conversación sea 100% manual por parte de los operadores humanos.

4. **Protocolo de Presencia Humana (`human_active`)**:
   - Si un operador humano envía un mensaje (`sender.type === 'agent'`), el sistema inmediatamente marca `human_active:${conversationId}` en Redis por 24 horas y vacía cualquier buffer pendiente.
   - Si una conversación es asignada a un operador (`assignee_id != bot_agent_id`), el bot se silencia. Si el operador desasigna la conversación (`assignee_id === null`), el bot se reactiva automáticamente.

5. **Mecanismo de Debounce Asíncrono (Ventana 4-8 Segundos)**:
   - Los usuarios de mensajería instantánea frecuentemente envían oraciones cortadas ("hola", "¿tienen stock?", "del taladro Bosch").
   - El servicio [`backend/services/webhook/debounceService.js`](file:///c:/Users/usuario/Desktop/kroserbot/backend/services/webhook/debounceService.js) utiliza un lock atómico en Redis (`conv_lock`) para retener la primera petición y acumular los mensajes siguientes en `conv_buffer:${conversationId}`. Al vencer la ventana, los combina en un único párrafo coherente, optimizando drásticamente los tokens y la calidad de la respuesta del LLM.

6. **Procesamiento Multimodal (Voz e Imágenes)**:
   - Archivos de audio (WhatsApp PTT/OGG): Descarga el binario y utiliza Gemini Multimodal o Whisper para transcribir el mensaje del cliente en español uruguayo.
   - Fotos de repuestos/etiquetas: Mediante visión computacional extrae términos de búsqueda técnica (ej: "grifería monocomando repuesto vástago 1/2"), inyectando los términos en el RAG.

---

## 4. Motor de Inteligencia Artificial y Razonamiento Agéntico (Tool Calling)

El bot opera bajo una arquitectura de **Llamada a Herramientas (Agentic Function Calling)** implementada en [`backend/services/llm/llmService.js`](file:///c:/Users/usuario/Desktop/kroserbot/backend/services/llm/llmService.js) y [`backend/services/webhook/toolExecutor.js`](file:///c:/Users/usuario/Desktop/kroserbot/backend/services/webhook/toolExecutor.js).

### 4.1. Conector Multi-Proveedor Dinámico

El administrador puede alternar en caliente el modelo y proveedor de IA desde el panel sin necesidad de reiniciar la aplicación:

- **Google Gemini**:
  - `gemini-1.5-flash`: Modelo de producción ultra rápido y económico (recomendado por defecto).
  - `gemini-1.5-pro`: Modelo de alto razonamiento para consultas técnicas avanzadas de plomería o electricidad.
  - `gemini-2.0-flash`: Nueva generación de alta velocidad con contexto masivo.
- **OpenAI & Compatibles**:
  - `gpt-4o-mini`: Alternativa rápida y equilibrada.
  - `gpt-4o`: Máxima precisión en clasificación e intenciones complejas.
  - **OpenAI-Compatible Endpoint**: Permite redirigir a proxies corporativos, Groq, Together AI o servidores locales (Ollama con Llama 3 / Mistral) configurando `OPENAI_BASE_URL`.

### 4.2. Catálogo de Herramientas Agénticas (Tools)

El LLM dispone de las siguientes 7 funciones declaradas en esquema JSON para resolver necesidades reales de negocio:

| Nombre de la Herramienta | Parámetros | Propósito Operativo |
| :--- | :--- | :--- |
| `buscar_productos` | `consulta: string` | Búsqueda semántica y por palabras clave en el catálogo de Kroser. Devuelve SKU, precios, stock y kits de consumibles. |
| `buscar_sucursales` | `zona?: string` | Localiza tiendas físicas, direcciones, números de teléfono y horarios de apertura en todo el Uruguay. |
| `buscar_envio` | `zona?: string` | Consulta costos de envío a domicilio por departamento y políticas de envío sin costo. |
| `formas_pago` | *(sin parámetros)* | Proporciona medios de pago vigentes, planes de cuotas con tarjetas y promociones comerciales. |
| `consultar_guia_tecnica` | `tema: string` | Consulta fórmulas de rendimiento de materiales (ej. m² por litro de pintura), tratamiento de patologías y sanitarias. |
| `consultar_pedido` | `referencia: string` | Permite el autoservicio de clientes consultando el estado de preparación o despacho de un pedido existente. |
| `registrar_pedido` | `cliente: object, items: array` | **Formaliza una orden de compra** en la base de datos una vez que el cliente validó todos sus datos de entrega. |

### 4.3. Algoritmo de Humanización y Delay de Tipeo

Para erradicar la sensación de hablar con un bot genérico, la función `cleanAndHumanizeReply()` aplica filtros automáticos:
- Elimina muletillas robotizadas (*"Como modelo de lenguaje...", "Espero haberle sido de ayuda..."*).
- Si la conversación ya está avanzada, remueve saludos iniciales redundantes (*"Hola de nuevo", "Buen día"*).
- **Simulación de tipeo biológico**: Calcula una demora basada en la extensión de la respuesta (~15ms por carácter, acotado entre 800ms y 3000ms), manteniendo activo el indicador de *"Escribiendo..."* en Chatwoot para una experiencia conversacional fluida y natural.

---

## 5. Catálogo Vectorial y Búsqueda Híbrida RAG

El motor de recuperación aumentada por generación (RAG) implementado en [`backend/services/embeddings/ragService.js`](file:///c:/Users/usuario/Desktop/kroserbot/backend/services/embeddings/ragService.js) combina tres técnicas de indexación para garantizar cero alucinaciones de productos:

### 5.1. Triangulación de Búsqueda Híbrida

```mermaid
graph TD
    Query["Consulta del Cliente\n(ej: 'esmalte sintetico blanco 1L')"] --> VectorSearch["1. Búsqueda Vectorial (pgvector)\nDistancia Coseno <=> (768 dim)\nUmbral mínimo: 0.52"]
    Query --> TrgmSearch["2. Búsqueda Difusa (pg_trgm)\nCoincidencia fonética y tipográfica"]
    Query --> ExactSearch["3. Búsqueda Exacta (unaccent)\nCoincidencia de SKU y marcas"]
    
    VectorSearch --> Fusion["Módulo de Fusión & Deduplicación"]
    TrgmSearch --> Fusion
    ExactSearch --> Fusion
    
    Fusion --> StockCheck{"¿Tiene stock\ndisponible?"}
    StockCheck -->|En Stock| CrossSell["Matriz de Venta Cruzada (CROSS_SELLING_MAP)\nAgrega consumibles recomendados"]
    StockCheck -->|Agotado| SmartSub["Sustitución Inteligente\nBusca producto equivalente misma marca/categoría"]
    
    CrossSell --> FinalPrompt["Inyección en Contexto de IA"]
    SmartSub --> FinalPrompt
```

### 5.2. Sustitución Inteligente de Productos Agotados

Si el producto consultado tiene estado `stock_status: out_of_stock`, la función `productosRepo.getAlternatives()` busca automáticamente hasta 3 artículos equivalentes de la misma categoría o marca con stock activo, instruyendo a la IA a sugerir el reemplazo amablemente:

> *"El esmalte marca X de 1L se encuentra momentáneamente sin stock, pero tenemos disponible el esmalte marca Y de similar rendimiento y calidad por $ 420 UYU."*

### 5.3. Matriz de Venta Cruzada (Cross-Selling Hardware Bundles)

Kroser no solo despacha artículos aislados, sino soluciones completas de refacción. La matriz `CROSS_SELLING_MAP` asocia familias de productos con consumibles indispensables:

- **Pinturas / Esmaltes**: rodillo, pincel, cinta de enmascarar, lija, bandeja, aguarrás, enduido.
- **Herramientas de Corte / Amoladoras**: discos de corte, discos flap, gafas protectoras, guantes de trabajo, protector auditivo.
- **Sanitaria / Griferías**: cinta teflón, colillas flexibles, llave francesa, sellador de silicona.
- **Construcción en Seco (Yeso / Drywall)**: soleras, montantes, tornillos T1/T2, masilla, cinta para juntas.

---

## 6. Sistema de Seguridad y Guardrails

El servicio [`backend/services/guardrails/guardrailService.js`](file:///c:/Users/usuario/Desktop/kroserbot/backend/services/guardrails/guardrailService.js) actúa como un cortafuegos bidireccional (inspección de entrada y salida) para proteger la marca Kroser y la infraestructura.

### 6.1. Matriz de Guardrails de Entrada

| Categoría | Patrones Detectados | Acción del Sistema | Severidad |
| :--- | :--- | :--- | :--- |
| **Prompt Injection / Jailbreak** | *"ignora instrucciones anteriores"*, *"actua como DAN"*, *"revela tu prompt"*, *"DROP TABLE"*, scripts | Bloqueo inmediato. Devuelve mensaje corporativo recordando el rol exclusivo de ferretería. | 🔴 Alta |
| **Lenguaje Abusivo / Insultos** | Insultos rioplatenses, agravios directos, amenazas | **Sistema de 3 Strikes**: en las primeras 2 incidencias responde con tono firme y cordial. Al 3er strike, bloquea y transfiere a supervisor con alerta. | 🟡 Media |
| **Consultas Fuera de Tema (Off-Topic)** | Política, religión, apuestas online, redacción de ensayos o tareas escolares | Desvío respetuoso invitando a consultar productos de catálogo o tiendas. | 🟢 Baja |
| **Spam / Keyboard Mashing** | Caracteres repetidos en exceso (`aaaaaaa`, `asdfghjk`), inundación de texto sin sentido | Solicita reformular la consulta de manera comprensible. | 🟢 Baja |
| **Control de Inundación (Flood Rate Limit)** | Más de 6 mensajes consecutivos en menos de 8 segundos por la misma conversación | Frena la ejecución y pide aguardar un momento para procesar la cola. | 🟢 Baja |

### 6.2. Filtro de Salida (Anti-Fuga de Datos Confidenciales)

Antes de emitir cualquier texto a Chatwoot, `filterOutput()` escanea la respuesta generada por el LLM en busca de cadenas sensibles como tokens de API (`AIza...`, `sk-...`), cadenas de conexión (`DATABASE_URL`) o fragmentos del system prompt. Si detecta una fuga, sustituye la respuesta por un mensaje seguro por defecto y registra un log de alerta crítica.

---

## 7. Protocolo de Derivación y Asignación Humana

Cuando una consulta excede el conocimiento del bot o requiere gestiones comerciales o administrativas directas, el LLM emite el comando formal `DERIVAR: [AREA]`.

```mermaid
flowchart TD
    LLMReply["LLM genera respuesta:\n'DERIVAR: ventas'"] --> Detect{"¿Empieza con DERIVAR:?"}
    Detect -->|Sí| ParseArea["Extrae área objetivo:\n(ecommerce, rrhh, administracion, franquicias, info)"]
    
    ParseArea --> Assignee["Obtiene assignee_id_area desde tabla configuracion"]
    ParseArea --> Silence["Activa human_active:<conv_id> en Redis (24h)\nCancela debounce & buffers"]
    
    Silence --> CW_Assign["Chatwoot API:\nAsigna conversación al asesor del área"]
    CW_Assign --> CW_Msg["Chatwoot API:\nEnvía msg_derivacion fijo al cliente"]
    
    CW_Assign --> DerivNote["Genera NOTA PRIVADA INTERNA (Private Note):\n1. Resumen ejecutivo de la charla\n2. Motivo de derivación\n3. Plan de acción en 3 pasos sugerido"]
    
    CW_Assign --> EmailAlert["SMTP Service:\nEnvía correo interno al responsable del área"]
    
    DerivNote --> Finish["Bot silenciado. Asesor toma el control."]
    EmailAlert --> Finish
```

### 7.1. Estructura de la Nota Privada para el Asesor

El servicio [`backend/services/chatwoot/derivationNoteService.js`](file:///c:/Users/usuario/Desktop/kroserbot/backend/services/chatwoot/derivationNoteService.js) redacta automáticamente una nota interna visible exclusivamente para los agentes dentro de Chatwoot:

```markdown
📋 RESUMEN DE LA CONVERSACIÓN:
• El cliente solicita cotización por 15 unidades de pintura látex exterior blanca 20L.
• Consultó por descuento corporativo para empresa constructora.

🚨 MOTIVO DE DERIVACIÓN:
• Consulta por compra mayorista y crédito comercial (Área E-COMMERCE / VENTAS).

💡 PLAN DE ACCIÓN SUGERIDO PARA EL ASESOR:
1. Verificar disponibilidad de lote en depósito central.
2. Aplicar escala de descuento por volumen según tabla comercial.
3. Solicitar RUT para facturación con crédito a 30 días.
```

---

## 8. Módulo de Gestión de Pedidos y E-commerce

El módulo de pedidos gestiona órdenes provenientes tanto de conversaciones asistidas por el bot como de correos electrónicos transaccionales de tiendas web (Tiendanube / Nuvemshop).

### 8.1. Máquina de Estados Determinista

Implementada en [`backend/services/pedidos/orderStateMachine.js`](file:///c:/Users/usuario/Desktop/kroserbot/backend/services/pedidos/orderStateMachine.js), previene transiciones ilógicas y asegura integridad operativa:

```mermaid
stateDiagram-v2
    [*] --> pendiente: Pedido creado por Chat / Web
    
    pendiente --> confirmado: Operador confirma stock / Pago MP aprobado
    pendiente --> rechazado: Falta de stock / Datos incorrectos
    pendiente --> cancelado: Cliente solicita desistir de la compra
    
    confirmado --> en_preparacion: Depósito inicia picking
    confirmado --> cancelado: Cancelación extraordinaria
    confirmado --> entregado: Retiro inmediato en mostrador
    
    en_preparacion --> entregado: Despachado por flete / Retirado
    en_preparacion --> cancelado: Cancelación de fuerza mayor
    
    rechazado --> [*]
    cancelado --> [*]
    entregado --> [*]
```

### 8.2. Ingestión de Pedidos de E-commerce (Tiendanube)

El servicio [`backend/services/ecommerce/ecommerceOrderService.js`](file:///c:/Users/usuario/Desktop/kroserbot/backend/services/ecommerce/ecommerceOrderService.js) monitorea las bandejas conectadas a correos de ventas online:
1. **Detección Automática**: Reconoce patrones de pedidos web mediante expresiones regulares de `ecommerceEmailParser.js`.
2. **Deduplicación**: Comprueba si el número de orden (`ecommerce_order_number`) ya existe en la base de datos para no duplicar pedidos.
3. **Auto-Confirmación Inmediata**: Si el correo confirma que el pedido ya fue pagado con tarjeta/Mercado Pago, la orden ingresa directamente en estado `confirmado`, enviando de inmediato la notificación de preparación al equipo de depósito.

### 8.3. Detección de Cancelación por el Cliente

Si un cliente escribe en el chat frases como *"ya no lo quiero"*, *"cancelen mi pedido"* o *"no me lo manden"* mientras la orden está en estado `pendiente`, `confirmado` o `en_preparacion`, el bot detecta la intención, ejecuta la transición a `cancelado` en la base de datos, envía la confirmación de cancelación y notifica internamente al depósito para frenar el empaque.

---

## 9. Integración con Mercado Pago

El sistema soporta cobranzas mediante **Mercado Pago Checkout Pro** con verificación criptográfica para garantizar máxima seguridad contra fraudes.

### 9.1. Flujo de Generación de Pagos y Webhooks

```mermaid
sequenceDiagram
    autonumber
    actor Cliente as Cliente
    participant Bot as Bot Kroser
    participant MP as API Mercado Pago
    participant WH as Webhook Mercado Pago (/api/mercadopago/webhook)
    participant Deposito as Panel Depósito / Alertas

    Cliente->>Bot: Solicita pagar pedido #1050
    Bot->>MP: Crea preferencia de pago (monto, ítems, pedido_1050)
    MP-->>Bot: Retorna init_point (URL de pago)
    Bot->>Cliente: Envía botón/link de pago de Mercado Pago
    Cliente->>MP: Realiza el pago con tarjeta o dinero en cuenta
    
    MP->>WH: POST /api/mercadopago/webhook (headers x-signature, x-request-id)
    Note over WH: Valida firma criptográfica HMAC-SHA256
    WH->>MP: Consulta estado de payment ID
    MP-->>WH: Estado: approved
    WH->>WH: Actualiza Pedido #1050 -> confirmado & pagado
    WH->>Deposito: Dispara alerta de preparación a Depósito
    WH->>Cliente: Envía confirmación de pago por WhatsApp/Web
```

### 9.2. Validación Criptográfica HMAC (`x-signature`)

El middleware [`backend/middleware/validateMercadopagoSignature.js`](file:///c:/Users/usuario/Desktop/kroserbot/backend/middleware/validateMercadopagoSignature.js) analiza la cabecera `x-signature`:
- Extrae el timestamp `ts` y el hash `v1`.
- Concatena el ID del evento, el timestamp y la clave secreta `MERCADOPAGO_WEBHOOK_SECRET`.
- Compara mediante `crypto.timingSafeEqual` para prevenir ataques de tiempo y descartar cualquier solicitud no originada legítimamente en los servidores de Mercado Pago.

---

## 10. Pipeline de Ingestión y Sincronización de Catálogo

Para mantener sincronizados los más de 10.000 artículos de ferretería, Kroserbot dispone de tres vías de ingestión implementadas en [`scraper/`](file:///c:/Users/usuario/Desktop/kroserbot/scraper/):

### 10.1. Scraper Web Python (Sitemap + Fenicio)

- **Extracción de URLs**: Analiza primero `sitemap.xml` y `sitemap-products.xml`. Si no está disponible, realiza un crawl paginado por `/catalogo?page=N`.
- **Navegación Orgánica**: Realiza una petición inicial a la portada para adquirir cookies de sesión y utiliza cabeceras reales de navegador con rate limiting de 8 segundos + jitter aleatorio para prevenir bloqueos por Cloudflare o WAFs.
- **Checkpointing & Resunción**: Guarda el cursor en la tabla `scraper_runs`. Si el proceso se interrumpe, el comando `python -m scraper run --resume` continúa exactamente en el producto donde quedó sin duplicar trabajo.
- **Detención Cooperativa (`stop_requested`)**: El operador puede detener el scraper de forma segura desde el panel admin; el runtime terminará el lote actual y cerrará la conexión limpiamente.

### 10.2. Conectores Alternativos (ERP)

- **Conector SQL Directo (`scraper/importers/sql_importer.py`)**: Conexión de solo lectura a la base de datos central de Kroser (PostgreSQL, MySQL o SQL Server) para sincronizaciones instantáneas de stock y listas de precios.
- **Conector API REST (`scraper/importers/api_importer.py`)**: Consumo periódico de endpoints JSON con autenticación Bearer provistos por el departamento de sistemas de Kroser.

### 10.3. Generación Programada de Embeddings

El script [`backend/services/embeddings/generateEmbeddings.js`](file:///c:/Users/usuario/Desktop/kroserbot/backend/services/embeddings/generateEmbeddings.js) toma todos los productos con `embedding IS NULL` o con modificaciones recientes y genera sus vectores en lotes de 50 ítems, calculando el embedding sobre la concatenación normalizada de: `nombre + marca + categoria + descripcion`.

---

## 11. Manual de Operación del Panel de Administración y Depósito

### 11.1. Estructura de Secciones del Panel Admin (`/admin`)

El panel accesible en `http://localhost:3000/admin` o en el dominio de producción cuenta con 13 consolas operativas unificadas:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🔴 KROSERBOT AI — Consola de Control Central (v1.0.0)      [Usuario: admin] │
├───────────┬───────────┬───────────┬───────────┬───────────┬─────────────────┤
│ Dashboard │ Prompt/IA │ Canales   │ Catálogo  │ Pedidos   │ Depósito 📦     │
│ Scraper   │ Sucursales│ Envíos    │ Pagos/MP  │ Guías     │ Contactos       │
└───────────┴───────────┴───────────┴───────────┴───────────┴─────────────────┘
```

1. **📊 Dashboard & Telemetría RAG**:
   - Métricas en tiempo real de pedidos por estado, total de productos vectorizados y volumen de transferencias humanas por área.
   - Visor de conversaciones en vivo con telemetría de herramientas agénticas ejecutadas y tiempos de respuesta.
2. **📝 Prompt & Mensajes Predeterminados**:
   - Edición en caliente del System Prompt maestro de la IA.
   - Configuración de respuestas automáticas fijas (`msg_pedido_pendiente`, `msg_pedido_listo`, `msg_pedido_rechazado`, `msg_derivacion`).
   - Pestaña de Historial de Prompts con opción de **Rollback inmediato** a versiones anteriores.
3. **🔌 Uruchat & Control de Canales**:
   - Conmutadores independientes para apagar el bot selectivamente en Instagram, WhatsApp, Web o bandejas específicas.
   - Configuración del Token de Uruchat y el ID numérico del bot.
4. **🗄️ Fuente de Datos**:
   - Selección entre Web Scraping, Conexión SQL ERP o API REST.
5. **🤖 Conector de Agente IA**:
   - Selección dinámica de proveedor (Gemini, OpenAI, Compatible).
   - Ajuste de temperatura creativa (recomendado: 0.3 a 0.5 para ferretería).
6. **🕷️ Control del Scraper**:
   - Estado de la última corrida (productos agregados, actualizados, fallas).
   - Botón de **"Iniciar Scraping Manual"** y **"Detener Scraper"**.
7. **🛒 Catálogo de Productos**:
   - Buscador de productos con filtros por categoría, marca y estado de vectorización.
8. **🏪 Gestión de Sucursales**:
   - Alta, baja y modificación de las 50+ sucursales físicas de Kroser en Uruguay (dirección, teléfonos y horarios de retiro).
9. **🚚 Zonas y Costos de Envío**:
   - Tarifario de fletes por departamento y localidad, y monto mínimo para envío gratuito.
10. **💳 Formas de Pago & Mercado Pago**:
    - Switch para activar/desactivar Checkout Pro y configuración de tokens y webhook secret.
11. **📦 Gestión de Pedidos**:
    - Tabla completa de órdenes comerciales con filtros por estado, visualización del carrito y botones para confirmar o rechazar.
12. **✉️ Contactos y Alertas por Área**:
    - Direcciones de email destinatarias para derivaciones de `ecommerce`, `rrhh`, `administracion`, `franquicias` e `info`.
13. **📚 Guías Técnicas y Fórmulas**:
    - Base de conocimiento de ferretería editable (rendimiento de pinturas m², humedades, plomería, fijaciones).

### 11.2. Operatoria del Panel de Depósito (`/deposito`)

La interfaz [`admin/deposito.html`](file:///c:/Users/usuario/Desktop/kroserbot/admin/deposito.html) está diseñada para tablets o monitores en el área de expedición:

1. **Filtro de Trabajo**: El operario selecciona la pestaña **"Confirmados"** para visualizar las órdenes listas para armar.
2. **Iniciar Picking**: Al hacer clic en **"Iniciar Preparación"**, el pedido pasa automáticamente a `en_preparacion`.
3. **Imprimir Hoja de Picking**: El botón de impresión genera una comanda física optimizada (formato A4 o ticket térmico) con la lista de SKUs, cantidades y ubicación de entrega/retiro.
4. **Despacho / Entrega**: Una vez embalado y retirado por el flete o cliente, el operario pulsa **"Marcar Entregado"**, completando el ciclo de vida del pedido.

---

## 12. Mantenimiento, Observabilidad y Matriz de Troubleshooting

### 12.1. Rutinas de Mantenimiento Periódico

```bash
# 1. Comprobar salud del backend y conexiones
curl -i http://localhost:3000/api/health

# 2. Ejecutar respaldo diario de base de datos Postgres
npm run db:backup

# 3. Aplicar migraciones estructurales de base de datos
npm run migrate:up

# 4. Limpiar logs acumulados de Docker
docker compose logs --tail=100 backend
```

### 12.2. Matriz de Resolución de Incidentes (Troubleshooting)

| Síntoma / Error | Causa Raíz Probable | Solución Paso a Paso |
| :--- | :--- | :--- |
| **El bot responde en un canal que debe ser 100% humano (ej. Instagram)** | La casilla de apagado del canal no está guardada o el nombre del inbox no coincide. | 1. Ir a `/admin` -> pestaña **🔌 Uruchat Integración**.<br>2. Marcar la casilla **"Apagar Bot"** en el canal correspondiente.<br>3. Si es un canal personalizado, ingresar el nombre o ID numérico del inbox en el campo inferior.<br>4. Pulsar **"💾 Guardar Control de Canales"**. |
| **El bot no responde a ningún cliente en WhatsApp / Web** | Webhook no configurado, bot sin token o servicio caído. | 1. Verificar que el webhook en Uruchat apunte a `https://tu-dominio.com/api/webhook`.<br>2. Comprobar que `http://localhost:3000/api/health` devuelva `"status": "ok"`.<br>3. Revisar en Redis si la conversación tiene activa la clave `human_active:<id>` eliminándola con `redis-cli del human_active:<id>`. |
| **Error `429 Too Many Requests` en llamadas a Gemini / OpenAI** | Se superó la cuota por minuto de la API key del proveedor de IA. | 1. El backend reintenta automáticamente tras 1.5s.<br>2. En el panel admin -> **🤖 Conector de Agente IA**, cambiar temporalmente el proveedor (ej. de Gemini a OpenAI) o renovar la API Key. |
| **El catálogo no encuentra productos recién publicados** | El producto no ha sido scrapeado o carece de vector de embedding. | 1. Ir a `/admin` -> pestaña **🕷️ Scraper** y pulsar **"Iniciar Scraping Manual"**.<br>2. Correr la generación de vectores: `node backend/services/embeddings/generateEmbeddings.js`. |
| **Webhooks de Mercado Pago fallan con `401 Unauthorized`** | Desajuste en el `MERCADOPAGO_WEBHOOK_SECRET` o expiración de timestamp. | 1. Verificar que el secreto copiado del panel de desarrolladores de Mercado Pago coincida con el valor en el `.env`.<br>2. Asegurar que la hora del servidor esté sincronizada vía NTP. |
| **Contenedor Postgres o Redis en estado `unhealthy`** | Problemas de permisos de volumen o puerto ocupado en el host. | 1. Ejecutar `docker compose ps` para identificar el contenedor en falla.<br>2. Revisar los logs específicos: `docker compose logs postgres` o `docker compose logs redis`.<br>3. Reiniciar el stack con `docker compose down && docker compose up -d`. |

---

**Kroser Uruguay — 2026** • *Manual Oficial de Arquitectura y Operación del Sistema Bot Kroser AI*

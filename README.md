# Cotizador Kroser Martínez (Krosmart v2.3.11) — RAG + Pedidos + Scraper + Panel Admin

Sistema integral de atención inteligente, recomendación técnica, búsqueda híbrida de catálogo (Full-Text + Vectorial RAG), cotización web y módulo de gestión de pedidos para **Kroser Martínez** (Kroser Uruguay), con **2 locales en La Unión, Montevideo**: Av. 8 de Octubre 3452 y su barraca en el 3451.

> **Krosmart** (Kroser Martínez) es el nombre comercial y de despliegue del proyecto. `kroserbot` se conserva únicamente como nombre técnico del repositorio de GitHub, la base de datos, los contenedores y los volúmenes existentes, para no romper compatibilidad.

---

## 🚀 Requisitos Previos

- **Node.js**: `v20` o superior
- **Python**: `3.10` o superior (para el scraper)
- **Docker** y **Docker Compose**
- **Git**

---

## 🛠️ Arranque Rápido en Desarrollo Local

### 1. Clonar el repositorio y configurar variables de entorno

```bash
cp .env.example .env
```
Edita `.env` con tus credenciales locales (OpenAI/Gemini, Uruchat, PostgreSQL, Redis, etc.).

### 2. Levantar la infraestructura (PostgreSQL 16 + pgvector y Redis 7)

```bash
docker-compose up -d
```

Verifica que los contenedores estén activos y saludables:
```bash
docker-compose ps
```

### 3. Instalar dependencias

```bash
npm install
```

### 4. Correr las migraciones de Base de Datos

```bash
npm run migrate:up
```

### 5. Control de Embeddings y Vectorización

```bash
# Ver estado actual de productos vectorizados vs pendientes
npm run embeddings:status

# Generar embeddings para productos pendientes (lotes de 50 ítems)
npm run embeddings:generate
```

### 6. Canal Web — Cotizador Kroser Martínez

Con el backend levantado, el cotizador público queda disponible en `http://localhost:3000/` y el panel administrativo en `http://localhost:3000/admin`.

Las cuentas de prueba (`*@cotibot.uy`) y el autocompletado de login **solo se muestran en local o agregando `?demo=1`**, para no exponer credenciales compartidas en producción.

### 7. Sincronización del catálogo Facturapp

La integración mantiene el catálogo local actualizado con **una sincronización incremental diaria**, protegida por un presupuesto de créditos y con reanudación automática. El análisis completo, la comparación de costos (una vs. dos sincronizaciones) y las instrucciones de operación están en [`FACTURAPP_SYNC.md`](FACTURAPP_SYNC.md).

```bash
# Estado, saldo y últimas corridas
curl -b admin_cookie.txt http://localhost:3000/api/facturapp/status

# Estimación sin consumir créditos
curl -b admin_cookie.txt "http://localhost:3000/api/facturapp/estimate?mode=initial"
```

> La sincronización inicial **no se ejecuta automáticamente**: requiere `confirmInitial=true` y valida el saldo antes de consumir créditos.

---

## 🐳 Docker Hub & Despliegue en Producción

### Imágenes Oficiales en Docker Hub (`alfredobartaburu/krosmart`):
- `alfredobartaburu/krosmart:v2.3.11`
- `alfredobartaburu/krosmart:latest`
- `alfredobartaburu/krosmart-scraper:v1.5`
- `alfredobartaburu/krosmart-scraper:latest`

> El nombre técnico del repositorio sigue siendo `kroserbot`; el nombre comercial y de despliegue es **Krosmart** (Kroser Martínez).

### Despliegue en Dokploy / Easypanel / Servidores Linux:
```bash
docker compose -f docker-compose.dokploy.yml pull
docker compose -f docker-compose.dokploy.yml up -d
```

---

## 🧪 Pruebas Automatizadas

```bash
# Ejecutar suite completa de backend (33 suites, 442 tests)
npm test

# Ejecutar tests del scraper en Python (24 tests)
npm run test:python
```

---

## 📂 Estructura del Proyecto

```text
krosmart/
├── /public                   # Cotizador Kroser Martínez (landing web, login de clientes y chat Cotibot)
├── /scraper                  # Scraper de catálogo en Python (Fenicio)
├── /scraequus                # Scraper y API de proveedor Equus (TypeScript + Fastify)
├── /backend                  # Servidor Express.js (Webhook Uruchat, RAG, Pedidos)
│   ├── /controllers          # Controladores REST (Auth, Cotibot, Clientes, Promos, Scraper)
│   ├── /services
│   │   ├── /embeddings       # Búsqueda vectorial, RAG y generación de embeddings 768d
│   │   ├── /search           # Búsqueda híbrida paralela, RRF y reranking
│   │   ├── /chatwoot         # API Uruchat, notas privadas y auto-resolve
│   │   ├── /webhook          # Webhooks, debounce, intent detector y handlers modulares
│   │   ├── /scraper          # Sincronización multi-proveedor y cálculo de precios
│   │   ├── /facturapp        # Catálogo Facturapp: sync, presupuesto y scheduler
│   │   └── /pedidos          # Lógica de pedidos y desambiguación de ferretería
│   └── /routes               # Rutas API REST
├── /admin                    # Panel administrativo (Vanilla HTML5 / CSS3 / ES6)
├── /db
│   ├── /migrations           # Migraciones SQL versionadas
│   ├── migrate.js            # Runner de migraciones (node-pg-migrate)
│   └── backup.sh             # Script de backup de PostgreSQL
├── docker-compose.yml        # Servicios PostgreSQL (pgvector) + Redis
├── docker-compose.dokploy.yml# Despliegue en Dokploy con Traefik
├── CHANGELOG.md              # Registro histórico de versiones y cambios
├── FACTURAPP_SYNC.md         # Análisis y operación de la sincronización Facturapp
└── AGENTS.md                 # Guía arquitectónica y mandamientos para agentes
```

---

## 📜 Convención de Commits (Conventional Commits)

- `feat:` nueva funcionalidad
- `fix:` corrección de errores
- `docs:` cambios en documentación
- `style:` formato, comas faltantes, etc. (sin cambios de código)
- `refactor:` refactorización de código sin cambiar funcionalidad
- `test:` adición o corrección de tests
- `chore:` tareas auxiliares (configuración, dependencias)

Ejemplo: `git commit -m "feat(embeddings): integracion de dashboard y post-scraper trigger"`

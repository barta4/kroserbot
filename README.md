# Bot Kroser (v2.1.9) — RAG + Pedidos + Scraper + Panel Admin

Sistema integral de atención inteligente, recomendación técnica, búsqueda híbrida de catálogo (Full-Text + Vectorial RAG) y módulo de gestión de pedidos para **Kroser Uruguay**.

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

---

## 🐳 Docker Hub & Despliegue en Producción

### Imágenes Oficiales en Docker Hub (`alfredobartaburu/kroserbot`):
- `alfredobartaburu/kroserbot:v2.1.9`
- `alfredobartaburu/kroserbot:latest`

### Despliegue en Dokploy / Easypanel / Servidores Linux:
```bash
docker compose -f docker-compose.dokploy.yml pull
docker compose -f docker-compose.dokploy.yml up -d
```

---

## 🧪 Pruebas Automatizadas

```bash
# Ejecutar suite completa de backend (24 suites, 314 tests)
npm test

# Ejecutar tests del scraper en Python (22 tests)
npm run test:python
```

---

## 📂 Estructura del Proyecto

```text
kroserbot/
├── /scraper                  # Scraper de catálogo en Python (Fenicio)
├── /backend                  # Servidor Express.js (Webhook Uruchat, RAG, Pedidos)
│   ├── /controllers          # Controladores REST (Auth, Config, Scraper, Embeddings)
│   ├── /services
│   │   ├── /embeddings       # Búsqueda vectorial, RAG y generación de embeddings 768d
│   │   ├── /search           # Búsqueda híbrida paralela, RRF y reranking
│   │   ├── /chatwoot         # API Uruchat, notas privadas y auto-resolve
│   │   ├── /webhook          # Procesamiento de webhooks, debounce e intent detector
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

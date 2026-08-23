# Bot Kroser — RAG + Pedidos + Scraper + Panel Admin

Sistema integral de atención automatizada, catálogo de productos con RAG y módulo de gestión de pedidos para Kroser Uruguay.

---

## 🚀 Requisitos Previos

- **Node.js**: `v18` o superior
- **Python**: `3.10` o superior (para el scraper)
- **Docker** y **Docker Compose**
- **Git**

---

## 🛠️ Arranque Rápido en Desarrollo Local

### 1. Clonar el repositorio y configurar variables de entorno

```bash
cp .env.example .env
```
Edita `.env` con tus credenciales locales (OpenAI/Gemini, Chatwoot, etc.).

### 2. Levantar la infraestructura (PostgreSQL + pgvector y Redis)

```bash
docker-compose up -d
```

Verifica que los contenedores estén activos:
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

---

## 🐳 Docker Hub & Despliegue en Producción

### Publicar imágenes en Docker Hub (`alfredobartaburu/kroserbot`):
```powershell
# En Windows (PowerShell):
.\scripts\build-and-push.ps1 -Tag "1.0.0"

# En Linux / Mac (Bash):
chmod +x ./scripts/build-and-push.sh
./scripts/build-and-push.sh "1.0.0"
```

### Desplegar en servidor con imágenes de Docker Hub:
```bash
docker compose -f docker-compose.prod.yml up -d
```

---

## 📂 Estructura del Proyecto

```
kroserbot/
├── /scraper                  # Scraper de catálogo en Python (Fenicio)
├── /backend                  # Servidor Express.js (Webhook Chatwoot, RAG, Pedidos)
│   ├── /services
│   │   ├── /embeddings       # Búsqueda vectorial y generación de embeddings
│   │   ├── /webhook          # Procesamiento de eventos Chatwoot & debounce
│   │   └── /pedidos          # Lógica de estados y carritos de compra
│   └── /routes               # Rutas API
├── /admin                    # Panel administrativo Next.js
├── /db
│   ├── /migrations           # Migraciones SQL versionadas
│   ├── migrate.js            # Runner de migraciones (node-pg-migrate)
│   └── backup.sh             # Script de backup de PostgreSQL
├── /coordinacion-multi-agente# Skill y guía de coordinación multi-agente
├── docker-compose.yml        # Servicios PostgreSQL (pgvector) + Redis
├── .env.example              # Plantilla de variables de entorno
└── ESTADO-TAREAS.md          # Control de estado de tareas
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

Ejemplo: `git commit -m "feat(db): add productos and pedidos tables migration"`

---

## 🤖 Coordinación Multi-Agente

Para trabajar con múltiples agentes o instancias en paralelo:
1. Revisa `ESTADO-TAREAS.md` antes de empezar.
2. Sigue las normas descritas en `coordinacion-multi-agente/SKILL.md`.
3. Marca tu tarea como `en_progreso` en tu propia rama `tarea/<numero>-<slug>`.

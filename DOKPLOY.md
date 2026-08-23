# 🚀 Guía de Despliegue en Dokploy (`venta.kroser.uy`)

Esta guía describe cómo desplegar **KroserBot** en un servidor con **Dokploy** bajo el dominio **`https://venta.kroser.uy`**.

---

## 📋 Pasos para el Despliegue

### 1. Crear el Proyecto en Dokploy
1. Inicia sesión en tu panel de Dokploy.
2. Crea un **Proyecto** (ej. `Kroser`) y añade un servicio de tipo **Compose**.

### 2. Configuración del Compose
- **Tipo de Fuente**: Puedes elegir **Git** (conectando tu repositorio `https://github.com/barta4/kroserbot`, rama `main`) o seleccionar **Raw Docker Compose**.
- **Archivo Compose**: Utiliza el archivo [`docker-compose.dokploy.yml`](./docker-compose.dokploy.yml).

### 3. Configurar Variables de Entorno
En la pestaña **Environment** del servicio en Dokploy, copia y pega las variables de [`.env.dokploy.example`](./.env.dokploy.example):

```env
POSTGRES_USER=kroser
POSTGRES_PASSWORD=tu_password_seguro_postgres
POSTGRES_DB=kroserbot

ADMIN_USER=admin
ADMIN_PASSWORD=tu_password_admin_panel
DEPOSITO_USER=deposito
DEPOSITO_PASSWORD=tu_password_deposito
JWT_SECRET=tu_jwt_secret_minimo_32_caracteres_aleatorios
WEBHOOK_BASIC_AUTH=kroser:tu_password_webhook

# API Keys de IA (al menos una)
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...

# Uruchat / Chatwoot
CHATWOOT_API_URL=https://app.uruchat.com
CHATWOOT_API_TOKEN=...
CHATWOOT_ACCOUNT_ID=1
```

### 4. Configuración del Dominio y SSL
- En el panel de DNS de tu dominio `kroser.uy`, crea un registro **A** o **CNAME**:
  - **Host**: `venta`
  - **Tipo**: `A` (apuntando a la IP de tu servidor Dokploy)
- `docker-compose.dokploy.yml` ya incluye las etiquetas de Traefik y Let's Encrypt para generar el certificado SSL automático.
- En la pestaña **Domains** de Dokploy, puedes también registrar `venta.kroser.uy` apuntando al servicio `backend` en el puerto `3000`.

### 5. Desplegar
- Haz clic en **Deploy**.
- Dokploy levantará automáticamente los 4 servicios:
  1. `kroserbot-postgres` (PostgreSQL 16 + pgvector)
  2. `kroserbot-redis` (Redis 7)
  3. `kroserbot-backend` (Node.js API + Panel Admin + Migraciones automáticas)
  4. `kroserbot-scraper` (Worker en Python para catálogo)

---

## 🌐 URLs del Sistema una vez Desplegado

- **Panel de Administración**: `https://venta.kroser.uy/admin`
- **Vista de Depósito**: `https://venta.kroser.uy/admin/deposito.html`
- **Webhook para Chatwoot / Uruchat**: `https://venta.kroser.uy/api/webhook/chatwoot`
- **Health Check**: `https://venta.kroser.uy/api/health`

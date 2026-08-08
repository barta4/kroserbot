# Tarea 00 — Setup del proyecto

## Objetivo
Dejar el repo listo para empezar a programar, con las herramientas base del proyecto completo (scraper + backend + admin).

## Tareas
- [ ] Estructura de carpetas: `/scraper`, `/backend`, `/admin`, `/db/migrations`
- [ ] `.env.example` documentando cada variable necesaria (DB, Redis, Chatwoot, LLM keys) — nunca subir `.env` real
- [ ] `.gitignore` (node_modules, .env, __pycache__, etc.)
- [ ] `docker-compose.yml` con Postgres (extensión pgvector) + Redis para desarrollo local
- [ ] Linter + formatter configurado (ESLint/Prettier o Ruff/Black según el stack elegido)
- [ ] README con instrucciones de arranque local (cómo levantar todo desde cero)
- [ ] Convención de commits (conventional commits) para mantener el historial legible

## Criterio de terminado
`docker-compose up` levanta Postgres y Redis sin errores, y el README alcanza para que otra persona arranque el proyecto sin preguntar nada.

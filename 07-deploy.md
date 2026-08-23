# Tarea 07 — Deploy & Docker Hub

## Objetivo
Poner todo en producción de forma reproducible mediante imágenes Docker optimizadas en Docker Hub (`alfredobartaburu/kroserbot`).

## Tareas Completadas
- [x] Dockerfile multi-stage en la raíz y en `backend/` con Node 20 Alpine, usuario no root y healthchecks integrados.
- [x] Dockerfile multi-stage en `scraper/` para la sincronización de catálogo.
- [x] `docker-compose.yml` parametrizado con imágenes de Docker Hub (`alfredobartaburu/kroserbot:${TAG:-latest}`).
- [x] `docker-compose.prod.yml` para despliegue productivo directo sin necesidad de compilar código fuente.
- [x] Scripts de compilación y publicación automatizada (`scripts/build-and-push.ps1` y `scripts/build-and-push.sh`).
- [x] Migraciones de base de datos ejecutadas automáticamente al iniciar el contenedor.

## Comandos de Publicación en Docker Hub

```powershell
# En PowerShell (Windows):
.\scripts\build-and-push.ps1 -Tag "1.0.0"

# O manualmente:
docker login
docker build -t alfredobartaburu/kroserbot:latest .
docker push alfredobartaburu/kroserbot:latest
```

## Despliegue en Servidor de Producción

```bash
# Iniciar stack completo con imágenes oficiales de Docker Hub:
docker compose -f docker-compose.prod.yml up -d
```


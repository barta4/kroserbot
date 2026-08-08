# Tarea 07 — Deploy

## Objetivo
Poner todo en producción de forma reproducible y con posibilidad de volver atrás si algo sale mal.

## Tareas
- [ ] Dockerfile multi-stage para backend, admin y scraper (imagen final liviana)
- [ ] `docker-compose.yml` de producción (o manifiestos separados si van a distintos servidores)
- [ ] Variables de entorno separadas por ambiente (dev/staging/prod) — nunca secretos en el repo
- [ ] CI básico: correr tests y linter en cada push antes de mergear
- [ ] Health checks configurados (reinicio automático si el backend cuelga)
- [ ] Estrategia de rollback simple (volver a la versión anterior rápido)

## Criterio de terminado
Un deploy nuevo se hace con un solo comando/pipeline, y si falla, volver a la versión anterior toma menos de 5 minutos.

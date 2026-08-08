---
name: coordinacion-multi-agente
description: Usa este skill siempre que dos o más agentes/modelos (por ejemplo dos instancias de Claude Code) vayan a trabajar en paralelo sobre el mismo repositorio de un proyecto dividido en tareas por archivo. Dispara este skill ante frases como "que no se pisen", "trabajar en paralelo", "dos modelos a la vez", "coordinar agentes", o cuando el usuario reparte tareas numeradas (00-tarea.md, 01-tarea.md, etc.) entre varios agentes. Define cómo reclamar una tarea antes de empezarla, qué rama usar, qué carpetas le tocan a cada tarea para no chocar archivos, y el orden de dependencias entre tareas.
---

# Coordinación multi-agente

Este skill evita que dos agentes trabajando en paralelo se pisen: sobreescriban el trabajo del otro, dupliquen una tarea, o rompan algo por editar el mismo archivo al mismo tiempo.

## Antes de tocar código

1. Leer `ESTADO-TAREAS.md` en la raíz del repo (si no existe, crearlo copiando la plantilla de `references/estado-tareas-template.md`).
2. Verificar en la tabla de dependencias que las tareas de las que depende la tuya ya están `done`. Si no lo están, avisar al usuario en vez de arrancar igual.
3. Marcar tu tarea como `en_progreso` en `ESTADO-TAREAS.md`, con tu nombre/modelo y la rama que vas a usar. Commitear **solo** ese cambio y pushear, para que el otro agente lo vea apenas haga `pull`.

## Reglas de ramas

- Nunca commitear directo a `main`.
- Una rama por tarea, nombrada `tarea/<numero>-<slug>` (ej. `tarea/02-scraper`).
- Antes de empezar a programar, hacer `git pull` sobre `main` y recién ahí crear la rama.
- Al terminar: abrir PR o mergear a `main`, y en el mismo commit/PR actualizar `ESTADO-TAREAS.md` a `done`.

## Ownership de carpetas

Cada tarea tiene una carpeta "de base" que le pertenece. Si tu tarea no está en esta lista, preguntale al usuario antes de asumir dónde va tu código.

| Tarea | Carpeta principal |
|---|---|
| 00-setup | raíz del repo, `docker-compose.yml`, `.env.example` |
| 01-base-datos | `/db/migrations` |
| 02-scraper | `/scraper` |
| 03-embeddings-rag | `/backend/services/embeddings` |
| 04-backend-api | `/backend/services/webhook`, `/backend/routes` |
| 05-pedidos | `/backend/services/pedidos` (carpeta separada de webhook, no comparte archivo con 04) |
| 06-panel-admin | `/admin` |
| 07-deploy | `/deploy`, Dockerfiles |
| 08-observabilidad | transversal — no crea carpeta propia, agrega logging/alertas dentro de las carpetas existentes; avisar si va a tocar código ajeno |

Regla general: si dos tareas necesitan registrar algo en un archivo compartido (ej. `routes/index.js` para sumar una ruta nueva), el que llega segundo hace `pull --rebase` antes de tocarlo. Nunca `push --force`.

## Migraciones de base de datos

Cualquier tarea puede necesitar agregar una migración. Reglas:
- El nombre del archivo siempre lleva timestamp (ej. `20250101120000_add_pedidos.sql`) para que dos migraciones creadas en paralelo no choquen de nombre.
- Nunca editar una migración que ya fue mergeada a `main` — si hay que corregir algo, se crea una migración nueva.

## Si hay conflicto real

- Gana quien commiteó primero; el segundo resuelve el conflicto a mano después de `pull --rebase`.
- Si el conflicto es grande o no es obvio cómo resolverlo, parar y preguntarle al usuario en vez de decidir a ciegas.

## Al terminar una tarea

1. Correr los tests de esa tarea localmente.
2. Actualizar `ESTADO-TAREAS.md` → `done`.
3. Revisar la tabla de dependencias: si tu tarea desbloquea otra, decirlo explícitamente en el commit/PR para que el otro agente (o el usuario) lo sepa.

Ver `references/estado-tareas-template.md` para la plantilla del archivo de estado.

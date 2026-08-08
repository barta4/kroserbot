# Estado de tareas — Bot Kroser

Actualizar esta tabla ANTES de empezar una tarea y ANTES de mergear el resultado. Es lo primero que cualquier agente debe leer.

| Tarea | Depende de | Estado | Agente | Rama |
|---|---|---|---|---|
| 00-setup | - | done | barta4 | tarea/00-setup |
| 01-base-datos | 00 | pendiente | | |
| 02-scraper | 00, 01 | en_progreso | opencode | tarea/02-scraper |
| 03-embeddings-rag | 01, 02 | pendiente | | |
| 04-backend-api | 00, 01 | pendiente | | |
| 05-pedidos | 01, 04 | pendiente | | |
| 06-panel-admin | 00, 01 | pendiente | | |
| 07-deploy | 04, 06 | pendiente | | |
| 08-observabilidad | 04 | pendiente | | |

Estados posibles: `pendiente` → `en_progreso` → `done`.

No tomar una tarea si alguna de sus dependencias no está en `done`.

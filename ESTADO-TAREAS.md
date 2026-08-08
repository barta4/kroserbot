# Estado de tareas — Bot Kroser

Actualizar esta tabla ANTES de empezar una tarea y ANTES de mergear el resultado. Es lo primero que cualquier agente debe leer.

| Tarea | Depende de | Estado | Agente | Rama |
|---|---|---|---|---|
| 00-setup | - | done | barta4 | tarea/00-setup |
| 01-base-datos | 00 | done | barta4 | tarea/01-base-datos |
| 02-scraper | 00, 01 | done | opencode | tarea/02-scraper |
| 03-embeddings-rag | 01, 02 | done | barta4 | tarea/03-embeddings-rag |
| 04-backend-api | 00, 01 | done | barta4 | tarea/04-backend-api |
| 05-pedidos | 01, 04 | done | barta4 | tarea/05-pedidos |
| 06-panel-admin | 00, 01 | done | barta4 | tarea/06-panel-admin |
| 07-deploy | 04, 06 | done | barta4 | tarea/07-deploy |
| 08-observabilidad | 04 | done | barta4 | tarea/08-observabilidad |

Estados posibles: `pendiente` → `en_progreso` → `done`.

No tomar una tarea si alguna de sus dependencias no está en `done`.

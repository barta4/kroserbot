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
| 09-busqueda-interpretacion-v2.1.7 | 04, 07 | done | antigravity | main |
| 10-rediseno-landing-v2.3.9 | 06 | done | opencode | main |
| 11-fix-catalogo-chat-v2.3.10 | 04, 10 | done | opencode | main |
| 12-whatsapp-canal-busqueda-v2.3.11 | 04, 09, 11 | done | opencode | main |
| 13-validacion-cliente | 10, 11, 12 | pendiente_aprobacion | cliente | - |

Estados posibles: `pendiente` → `en_progreso` → `done`; `pendiente_aprobacion` = entregado, esperando OK del cliente.

No tomar una tarea si alguna de sus dependencias no está en `done`.

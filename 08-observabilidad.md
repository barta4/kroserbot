# Tarea 08 — Observabilidad y mantenimiento

## Objetivo
Poder detectar y diagnosticar problemas sin tener que estar mirando el sistema todo el día.

## Tareas
- [ ] Logs centralizados con retención definida — nunca loguear datos sensibles del cliente (cédula, fecha de nacimiento) en texto plano
- [ ] Backups automáticos de Postgres (diarios) + prueba real de restore
- [ ] Alertas: scraper falla o se queda colgado, backend caído, LLM sin responder, pedidos `pendiente` acumulados
- [ ] Revisión de seguridad básica: rate limiting, sanitización de inputs, secretos rotables
- [ ] Documentación mínima de arquitectura para que otra persona pueda mantener el sistema

## Criterio de terminado
Si el scraper se cuelga o el backend se cae a las 3 de la mañana, alguien se entera esa misma noche, no al otro día por una queja de un cliente.

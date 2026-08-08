# Tarea 06 — Panel Admin

## Objetivo
Interfaz para que el equipo de Kroser edite el prompt, gestione pedidos y locales, y controle el scraper — sin tocar código.

## Tareas
- [ ] Autenticación real (no hardcodear usuario/clave) — hash de contraseña, sesión con expiración
- [ ] Editor del `system_prompt` con historial de versiones (poder ver qué cambió y volver atrás)
- [ ] Editor de los mensajes fijos (`msg_pedido_pendiente`, `msg_pedido_listo`, `msg_pedido_rechazado`, `msg_derivacion`)
- [ ] Vista de catálogo scrapeado (buscar/filtrar productos)
- [ ] Ventana "Pedidos": tabla paginada, filtrable por estado (pendiente/confirmado/rechazado/cancelado/entregado), con botones "Confirmar" y "Rechazar" que disparan el aviso correspondiente
- [ ] Gestión de `locales` (CRUD de direcciones/horarios/teléfonos)
- [ ] **Control del scraper:**
  - Botón "Iniciar scraping" → llama a `POST /scraper/start`
  - Botón "Detener" → llama a `POST /scraper/stop`, visible solo si hay una corrida en curso
  - Estado en vivo: página actual, productos nuevos/actualizados, tiempo transcurrido (poll a `GET /scraper/status`)
- [ ] Dashboard básico: pedidos por día, derivaciones a humano, productos más consultados
- [ ] Validación de formularios en frontend y backend (nunca confiar solo en el frontend)
- [ ] Confirmación antes de acciones irreversibles (rechazar pedido, borrar producto)

## Criterio de terminado
Alguien sin acceso a código puede: editar el prompt, confirmar/rechazar un pedido, y arrancar/detener un scraping — todo desde el panel.

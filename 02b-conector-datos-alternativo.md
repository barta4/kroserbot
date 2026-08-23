# Tarea 02b — Conector alternativo de datos (SQL directo / API)

## Objetivo
Si Kroser da acceso directo a su base de datos o expone una API, usar eso en vez del scraping (o como fuente principal, dejando el scraping como plan B). Es más confiable: no depende de parsear HTML que puede cambiar, y evita desincronización de precios/stock.

## Diseño
- Capa de "importador de productos" con interfaz común: no importa la fuente, todas terminan escribiendo en la misma tabla `productos`, con el mismo formato.
- `configuracion.fuente_datos` = `scraping` | `sql_directo` | `api` — se elige sin tocar código.
- Si la fuente principal falla, cae a scraping como fallback (si está configurado).

## Conector SQL directo
- [ ] Pedir usuario de **solo lectura** a la base de Kroser — nunca un usuario con permisos de escritura
- [ ] Conexión por variables de entorno separadas (host, puerto, usuario, password) — nunca hardcodeado
- [ ] Mapeo de columnas de su schema a las nuestras (nombre, precio, sku, categoria, stock, imagen) — documentar el mapeo real una vez que tengamos acceso a ver su schema
- [ ] Igual que el scraper: traer solo lo nuevo/modificado (por fecha de actualización si su tabla la tiene, o por hash de los campos si no)
- [ ] Túnel seguro si la base no es pública (SSH tunnel o VPN) — nunca exponer su DB directo a internet
- [ ] Límite bajo de conexiones simultáneas, para no cargar su base de producción

## Conector API (si en vez de DB exponen un endpoint REST)
- [ ] Autenticación según lo que definan (API key, OAuth, etc.) — se guarda como secreto, nunca en el repo
- [ ] Paginación según lo que soporte su API
- [ ] Misma lógica de "solo lo nuevo/modificado" (parámetro `updated_since` si existe, o comparar contra lo que ya tenemos)
- [ ] Respetar el rate limit que ellos definan (leer su documentación, no asumir)
- [ ] Reintentos con backoff ante errores 5xx

## Cuándo usar cada fuente
- Si dan DB o API: pasa a ser la fuente principal — es la fuente de verdad real de ellos
- Scraping queda como plan B si en algún momento se pierde ese acceso

## Criterio de terminado
Con credenciales de prueba de Kroser, un import trae productos reales a `productos` con los mismos campos que ya usa el resto del sistema — sin que el RAG ni el panel admin necesiten saber de dónde vinieron.

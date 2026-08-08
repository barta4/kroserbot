# Tarea 02 — Scraper de Kroser.com.uy

## Objetivo
Traer todo el catálogo de Kroser a la tabla `productos`, de forma que se pueda correr repetidas veces sin duplicar ni saturar el sitio, y que se pueda **detener manualmente en cualquier momento** desde el panel admin.

---

## Datos del sitio (para que el agente no tenga que redescubrirlos)

Kroser usa la plataforma **Fenicio eCommerce**. Esto es lo que ya sabemos, verificar cada punto contra el sitio real antes de programar:

- **Carga inicial:** los primeros productos (12-24) vienen en el HTML inicial (SSR), en tarjetas tipo `product-item` / `item-box`.
- **Paginación / scroll infinito:** al bajar o tocar "Ver más" dispara una llamada a `https://www.kroser.com.uy/catalogo?page=N` (puede devolver HTML parcial para inyectar, o JSON — confirmar con DevTools → Network → Fetch/XHR antes de programar el parser).
- **Sitemap (preferido si existe):** intentar primero `https://www.kroser.com.uy/sitemap.xml` → buscar `sitemap-products.xml` con URLs directas de cada producto. Es más liviano y estable que iterar páginas.
- **Categorías:** rutas tipo `/catalogo/herramientas`, `/catalogo/pinturas`, o parámetro `?categoria=X`.
- **Datos por producto:**
  - Nombre → tag tipo `<h2 class="name">`
  - Precio → tag tipo `<span class="price">` (puede haber precio lista y precio oferta)
  - Marca (ej. Truper, Kroser)
  - SKU/código → atributo `data-id` o `data-sku` en el contenedor
  - Imagen → `<img src="...">`
  - URL del producto → `<a href="/articulo/...">`
  - Stock → normalmente booleano (in_stock/out_of_stock), no cantidad exacta. Para cantidad real habría que entrar a la ficha individual (opcional, evaluar si vale la pena).
- **Headers necesarios:** `User-Agent` de navegador real (nunca el de la librería HTTP), `Accept-Language: es-UY,es;q=0.9`, `Referer: https://www.kroser.com.uy/catalogo`.
- **Cookies:** hacer un request previo a la home para levantar cookies de sesión y reusarlas en toda la corrida (`requests.Session()` o equivalente).

**Antes de escribir el parser final:** correr el request de prueba (home + catálogo + sitemap) y confirmar contra la respuesta real cuál mecanismo aplica. No asumir ciegamente lo de arriba.

---

## Scraping inteligente (no es un scraper cualquiera)

- [ ] Delay entre requests **aleatorio**, no fijo: ~8s con jitter (ej. entre 6 y 11s)
- [ ] Nunca paralelo/concurrente contra el sitio — un request a la vez, secuencial
- [ ] Reintentos con backoff exponencial ante 403/429/timeout (máx. 3 intentos, después salta al siguiente y lo loguea como fallido)
- [ ] Si detecta bloqueo sostenido (varios 403/429 seguidos) o captcha, **corta la corrida solo, no insiste** — mejor loguearlo y avisar que seguir insistiendo y que baneen la IP
- [ ] Respetar `robots.txt`
- [ ] **Incremental, no todo de cero cada vez:** comparar `lastmod` del sitemap (o hash del contenido de la ficha) contra lo que ya está en `productos.updated_at` — si no cambió, no volver a pedirlo
- [ ] **Checkpointing:** guardar en `scraper_runs` la página/posición actual, así si se corta (error, detención manual, caída del server) la próxima corrida puede retomar desde ahí en vez de arrancar de cero
- [ ] Upsert idempotente por `sku` (correr dos veces seguidas no duplica nada)
- [ ] Productos que dejaron de aparecer → marcar `discontinuado = true`, no borrar
- [ ] Logging estructurado (JSON): nuevos, actualizados, discontinuados, errores, tiempo total

---

## Botón de detener

El scraping puede tardar (miles de productos a ~8s cada uno), así que tiene que poder frenarse a mitad de camino sin dejar la base en un estado raro.

- [ ] Al arrancar una corrida, crear un registro en `scraper_runs` con `status = running`
- [ ] El proceso del scraper, **entre cada producto/página**, chequea si `stop_requested = true` en su registro de `scraper_runs`
- [ ] Si está en `true`: termina el producto/página en curso (no lo corta a la mitad), guarda el checkpoint actual, marca `status = stopped`, y sale limpio
- [ ] Endpoint backend `POST /scraper/stop` → setea `stop_requested = true` en la corrida activa
- [ ] Endpoint backend `GET /scraper/status` → devuelve estado actual (running/stopped/completed/failed) y progreso (página actual, cuántos productos van)
- [ ] El botón "Detener" en el panel admin (tarea 06) solo aparece si hay una corrida en curso, y llama a `/scraper/stop`
- [ ] Al iniciar una nueva corrida después de una detenida, preguntar (o dejar configurable) si retoma desde el checkpoint o arranca de cero

## Criterio de terminado
Se puede iniciar el scraper, verlo progresar, apretar "Detener" y que pare limpio en menos de ~10s (el tiempo del delay entre productos), sin dejar productos a medio guardar ni duplicados al volver a correrlo.

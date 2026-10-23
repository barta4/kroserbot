# Scraper inteligente de Equus.uy con API propia

## 1. Objetivo

Mantener un catálogo local de productos de Equus Uruguay y exponerlo por una API REST, sin visitar la web de Equus en cada consulta.

Tres piezas separadas:

1. **Recolección** (scraper con ritmo humano)
2. **Almacenamiento** (PostgreSQL)
3. **API de consulta** (Fastify)

> La API nunca ejecuta el scraper en tiempo real. Solo lee de la base de datos. Si Equus cae, la API sigue respondiendo con el último dato guardado.

---

## 2. Arquitectura

```
Equus.uy
   │
   ▼
Planificador (cola de URLs, prioridades, reintentos)
   ├── Descubrimiento: categorías y productos nuevos
   └── Actualización: precios y stock
   │
   ▼
PostgreSQL (catálogo + historial)
   │
   ▼
API REST (Fastify) → bot · n8n · apps · clientes
```

---

## 3. Comportamiento "humano" (ritmo respetuoso)

El objetivo es **no sobrecargar el sitio** y respetar su política oficial de rastreo.

| Regla | Detalle |
|---|---|
| Concurrencia | 1 solicitud activa a la vez |
| Pausas | **30 segundos** entre páginas (cumpliendo `Crawl-delay: 30` de `robots.txt`) |
| Rendimiento | **2 req/min · 120 req/hora · ~2.880 req/día** (catálogo completo en ~24h) |
| Horario | Preferir horas de baja carga para barridos masivos |
| Orden | No lineal: mezclar categorías, no recorrer todo seguido |
| User-Agent | Identificable con contacto |
| Cache | Respetar `ETag` / `Last-Modified` cuando existan |
| robots.txt | Verificado: Apache + PHP 5.6, `Crawl-delay: 30`, sin Cloudflare |

**No se implementa:** rotación de IP, evasión de CAPTCHA ni técnicas para eludir controles de acceso.

---

## 4. Planificación inteligente

Cola persistente en PostgreSQL (Redis + BullMQ solo si crece el volumen).

| Tipo de trabajo | Frecuencia inicial |
|---|---|
| Productos nuevos | Descubrimiento gradual de categorías |
| Populares | Cada 6–12 h |
| Normales | Cada 24–72 h |
| Poco consultados | Cada 7–14 días |
| Con errores | Reintento limitado y programado |

*Son valores de partida, a ajustar según permiso y comportamiento real del sitio.*

Prioridad: primero lo que lleva más tiempo sin revisarse.

---

## 5. Protecciones

- **Detección de cambios:** guardar un `content_hash` y actualizar solo si cambia.
- **Errores 429 / 403 / 503 / CAPTCHA:** pausar la cola y esperar con backoff creciente.
- **Cortacircuitos:** errores repetidos → la cola se detiene sola.
- **Reanudación:** guardar el último trabajo completado para retomar tras reiniciar Docker.
- **Bajas seguras:** un fallo de solicitud no borra el producto; pasa a `pendiente_verificacion`.

---

## 6. Modelo de datos

Ejemplo de producto normalizado:

```json
{
  "source": "equus.uy",
  "source_id": "SS0606A",
  "name": "Andamio Multiuso Equus",
  "category": "Construcción/Andamios",
  "price": { "amount": 13990, "currency": "UYU", "tax_included": true },
  "availability": "in_stock",
  "description": "Andamio multiuso con ruedas y frenos",
  "product_url": "URL_ORIGINAL",
  "last_seen_at": "2026-10-09T12:00:00-03:00",
  "last_checked_at": "2026-10-09T12:00:00-03:00",
  "content_hash": "HASH"
}
```

*Es un ejemplo de esquema, no un dato recién extraído.*

Tablas previstas:

- `products`
- `price_history`
- `availability_history`
- `categories`
- `jobs` (cola)
- `scrape_errors`

Estados de producto: `activo` · `no_encontrado` · `pendiente_verificacion`.

Imágenes: guardar solo la URL de origen, y únicamente si su reutilización está autorizada.

---

## 7. API

| Método | Ruta | Función |
|---|---|---|
| GET | `/v1/products` | Búsqueda con paginación y filtros (categoría, disponibilidad, precio) |
| GET | `/v1/products/:code` | Producto por código |
| GET | `/v1/categories` | Categorías detectadas |
| GET | `/v1/changes?since=` | Cambios de precio y stock desde una fecha |
| GET | `/v1/health` | Estado de API, base y última sincronización |

Requisitos: API keys, límite de consumo, paginación y fecha de actualización en cada respuesta. **Sin** endpoint que permita lanzar extracciones arbitrarias.

---

## 8. Stack

- Node.js + TypeScript
- Fastify
- Cheerio (HTML estático)
- Playwright (solo si algo depende de JavaScript)
- PostgreSQL
- Redis + BullMQ (opcional, más adelante)
- Docker

---

## 9. Decisiones pendientes

- [ ] **Uso:** ¿solo bot/apps propias, apps propias + terceros, o API comercial?
- [ ] **Tamaño:** ¿hasta 500, 500–5.000, o más de 5.000 productos?
- [ ] **Permiso:** ¿hay autorización de Equus para extraer y reutilizar datos? (Si se ofrece a terceros o comercialmente, conviene pedirla.)
- [x] **robots.txt:** Verificado (Apache directo, PHP 5.6.40, `Crawl-delay: 30` confirmado).

---

## 10. Plan por pasos

1. [x] Revisar `robots.txt` y cabeceras del servidor.
2. [x] Prototipo de **solo lectura**: 1 categoría + 3 fichas, para validar selectores, codificación (windows-1252/utf-8), moneda y stock. (Completado y probado con éxito).
3. Crear Docker Compose con PostgreSQL.
4. Crear tablas y guardar los productos del prototipo.
5. Agregar cola con intervalo estricto de 30 segundos y cortacircuitos.
6. Agregar detección de cambios e historial.
7. Levantar la API con Fastify y API keys.
8. Ampliar a más categorías de forma gradual.

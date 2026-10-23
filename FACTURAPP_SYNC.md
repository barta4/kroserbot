# Sincronización del catálogo Facturapp

Implementación de referencia para mantener el catálogo local actualizado consumiendo la menor cantidad posible de créditos.

> **Estado del análisis:** `FACTURAPP_API.md` no estaba disponible en el repositorio. El contrato se obtuvo de forma controlada desde `GET /api/catalogo` (gratuito) y de 5 consultas reales a `articulos/listar` durante la etapa de análisis. No se ejecutó ninguna sincronización completa.

---

## 1. Análisis de la API

### Autenticación

- Base: `https://mcp.facturapp.com.uy`
- Sin clave, todos los endpoints responden `401`.
- Formatos aceptados: `Authorization: Bearer <API_KEY>` o `x-api-key: <API_KEY>`.
- La clave se lee exclusivamente de `FACTURAPP_API_KEY` y nunca se registra ni se envía al navegador.

### Operaciones y costo

| Operación | Costo | Uso |
|---|---:|---|
| `GET /api/cuenta/saldo` | 0 | Saldo y vigencia del plan |
| `GET /api/catalogo` | 0 | Contrato de operaciones y parámetros |
| `GET /api/articulos/listar` | 1 por página | Recorrido inicial e incremental |
| `GET /api/articulos/porCodigo` | 1 | Consulta puntual por código |
| `GET /api/articulos/buscar` | 1 | Búsqueda por texto |
| `GET /api/articulos/stock` | 1 | Stock por terminal/sucursal |

Cada consulta pagada consume un crédito **aunque devuelva una respuesta vacía**.

### `GET /api/articulos/listar`

Parámetros reales:

| Parámetro | Tipo | Límites | Observación |
|---|---|---|---|
| `desdeId` | entero | 0..2147483647 | Devuelve registros con `id > desdeId` |
| `cantidad` | entero | 1..200 | Default 50. Usamos 200 |
| `soloActivos` | booleano | — | Default `true`. **Usamos `false` para detectar bajas** |
| `modificadosDesde` | fecha | — | `AAAA-MM-DD` o ISO 8601 |

Respuesta observada:

```json
{
  "ok": true,
  "operacion": "articulos.listar",
  "resultado": "ok",
  "cantidad": 200,
  "datos": [
    {
      "id": 1,
      "codigo": "555",
      "codigoBarras": "",
      "descripcion": "GENERICO",
      "descripcionAvanzada": "",
      "precioVenta": 1101.64,
      "precioCompra": 786.885,
      "idMoneda": 2,
      "moneda": "U$S",
      "ivaPorcentaje": 22,
      "stockActual": 33350.32,
      "stockMinimo": 0,
      "unidadMedida": "Uni",
      "idRamo": 1,
      "idFamilia": 1,
      "idGrupo": 1,
      "idMarca": 0,
      "idProveedor": 0,
      "codigoProveedor": "ENVIOGRATIS",
      "activo": true,
      "fechaVigenciaPrecio": "2026-10-22T00:00:00",
      "fechaUpdate": "2026-10-23T17:44:35.61"
    }
  ],
  "siguienteDesdeId": 200,
  "creditos": { "consumidos": 1, "mes": "2026-10", "plan": "Prueba", "mensuales": 50, "usadosMes": 3, "disponiblesMes": 47, "extra": 0 },
  "requestId": "..."
}
```

### Comportamiento verificado

- **Paginación:** `siguienteDesdeId` es el último `id` devuelto, no un número de página. Se debe reenviar como `desdeId`.
- **IDs secuenciales en el maestro:** página 1 devolvió `id` 1..200 y página 2 devolvió 201..400.
- **Inactivos:** con `soloActivos=false` se incluyen artículos con `activo:false` (22 en la segunda página). Con el valor por defecto quedan ocultos.
- **Incremental:** `modificadosDesde` devuelve **todos los campos**, incluidos `precioVenta`, `precioCompra`, `stockActual` y `fechaUpdate`. No hace falta una consulta por producto para precio/stock.
- **IDs dispersos en incremental:** una página de 10 modificados devolvió IDs entre 1 y 575 y `siguienteDesdeId: 575`. No asumir que los IDs son contiguos dentro del incremental.
- **Sin totalizador:** no existe un endpoint de conteo. La cantidad inicial se estima con `FACTURAPP_EXPECTED_ARTICLES` o con el historial de una corrida anterior.

### Limitaciones detectadas

1. No hay endpoint de cantidad total de artículos.
2. La lista no trae nombres de marca, ramo, familia ni grupo: solo IDs numéricos.
3. No trae imágenes ni URL de producto.
4. No se verificó un borrado físico; la baja observada es `activo:false`. **Nunca se eliminan productos locales por no aparecer en un incremental.**
5. La fecha de `modificadosDesde` se compara contra la fecha de modificación guardada por la empresa; se retrocede un día para cubrir bordes horarios.
6. No se dispone de `FACTURAPP_API.md`; las reglas de reintento se implementaron de forma conservadora (ver §6).

---

## 2. Estrategia recomendada

### Inicial (una sola vez)

1. Consultar `/api/cuenta/saldo` (gratis).
2. Estimar consultas: `ceil(N / 200) + 1` (la última consulta confirma que no hay más páginas).
3. Comparar con `disponiblesMes - FACTURAPP_SYNC_RESERVE_CREDITS`.
4. Recorrer con `desdeId` y `siguienteDesdeId`, `cantidad=200`, `soloActivos=false`.
5. Guardar cada página en una transacción y persistir el `desdeId` confirmado.
6. Detenerse si se agota el presupuesto o se alcanza `maxPages`; la corrida queda `paused` y reanudable.

### Incremental diaria

1. `modificadosDesde = última sincronización exitosa - 1 día`.
2. `cantidad=200`, `soloActivos=false`.
3. Seguir `siguienteDesdeId` hasta una página vacía.
4. Upsert por `facturapp_id`; insertar nuevos y actualizar existentes.
5. No sobrescribir con `NULL` los campos ausentes (se usa `COALESCE`).
6. Actualizar `last_success_at` **solo al completar todas las páginas**.
7. Si falla una página, conservar las anteriores y reanudar desde el último `desdeId` confirmado.

---

## 3. Costo mensual: una vs. dos sincronizaciones

Plan actual observado: **Prueba, 50 créditos/mes**. Al cierre del análisis quedaban **45** (se consumieron 5 en pruebas controladas).

### Inicial

| Artículos | Consultas estimadas |
|---:|---:|
| 2.000 | 11 |
| 5.000 | 26 |
| 8.800 | 45 (máximo con el saldo actual y reserva 5) |
| 10.000 | 51 |
| 20.000 | 101 |
| 50.000 | 251 |

**Si el maestro supera ~8.800 artículos, la inicial no cabe en el saldo actual.** Opciones: ampliar el plan, comprar créditos extra o reducir el alcance. No se recomienda una inicial parcial seguida de meses de espera: el catálogo quedaría incompleto.

### Incremental

| Cambios diarios | Consultas/día | Consultas/mes (30 días) |
|---|---:|---:|
| 0 | 1 | 30 |
| 1–200 | 2 | 60 |
| 201–400 | 3 | 90 |
| 401–600 | 4 | 120 |

### Comparación

| Escenario | Consultas/mes | Retraso máximo | Riesgo con plan 50/mes |
|---|---:|---|---|
| **A. Una incremental diaria** | 30–60 típico | 24 h | Bajo si los cambios diarios son ≤200 |
| **B. Dos incrementales diarias** | 60–120 | 12 h | **Alto: supera el plan en casi todos los casos** |
| **C. Una diaria + consultas puntuales** | 30–60 + 1 por consulta | 24 h (salvo consulta puntual) | Bajo y controlable |

**Recomendación: A (una diaria a las 04:00) con reserva de 5 créditos.** B solo se justifica si el negocio necesita reflejar cambios en menos de 12 h y el plan se amplía a ≥120 créditos/mes. C es útil para consultas urgentes de stock/precio de un producto puntual, pero no reemplaza la sincronización.

---

## 4. Persistencia y recuperación

### Tablas

- `facturapp_sync_state` (una fila):
  - `last_success_at`: última corrida completa.
  - `last_cutoff`: fecha de corte usada.
  - `pending_mode`, `pending_cutoff`, `pending_desde_id`, `pending_run_id`: corrida a reanudar.
- `facturapp_sync_runs`:
  - modo, estado (`running`, `paused`, `completed`, `failed`, `cancelled`), `triggered_by`, `dry_run`.
  - `cutoff`, `desde_id_inicial`, `last_desde_id`, `max_pages`.
  - páginas, artículos recibidos, insertados, actualizados, sin cambios, desactivados.
  - créditos inicio/consumidos/fin, errores, `last_error`, `last_request_id`, `stop_reason`.
- `productos`:
  - `facturapp_id` (único), `facturapp_codigo`, `facturapp_codigo_barras`, `facturapp_updated_at`, `facturapp_activo`.
  - `stock_actual`, `stock_minimo`, `unidad_medida`, `iva_porcentaje`.
  - IDs de ramo/familia/grupo/marca/proveedor y `facturapp_raw` (JSONB).

### Garantías

- Cada página se confirma en una transacción.
- El estado se actualiza después del commit de la página.
- Reanudar reprocesa como máximo la última página no confirmada (upsert idempotente).
- `last_success_at` no se toca si la corrida queda `paused` o `failed`.
- Los productos locales nunca se borran por ausencia en un incremental.
- El lock `facturapp:sync:lock` (Redis, 6 h) impide corridas simultáneas; una corrida `running` de más de 6 h se marca `paused` para recuperación.

---

## 5. Uso

### Variables de entorno

```env
FACTURAPP_API_KEY=...
FACTURAPP_API_URL=https://mcp.facturapp.com.uy
FACTURAPP_SYNC_ENABLED=false        # true para el scheduler diario
FACTURAPP_SYNC_HOUR=4               # hora Uruguay (UTC-3)
FACTURAPP_SYNC_MINUTE=0
FACTURAPP_SYNC_RESERVE_CREDITS=5    # créditos que nunca se tocan
FACTURAPP_SYNC_MAX_PAGES=40         # tope por corrida
FACTURAPP_EXPECTED_ARTICLES=        # cantidad aproximada para estimar la inicial
FACTURAPP_SYNC_EMBEDDINGS=true
FACTURAPP_SYNC_AUTO_CONFIRM_INITIAL=false
```

### Migración

```bash
npm run migrate:up
```

### Endpoints (solo admin)

```bash
# Estado, saldo y últimas corridas
GET /api/facturapp/status

# Estimación sin consumir créditos
GET /api/facturapp/estimate?mode=initial
GET /api/facturapp/estimate?mode=incremental

# Sincronización manual (responde 202 y corre en segundo plano)
POST /api/facturapp/sync
{ "mode": "incremental", "maxPages": 10 }

# Inicial (requiere confirmación explícita)
POST /api/facturapp/sync
{ "mode": "initial", "confirmInitial": true, "maxPages": 45 }

# Simulación sin consumir créditos
POST /api/facturapp/sync
{ "mode": "initial", "dryRun": true }

# Historial
GET /api/facturapp/runs?limit=20
```

### Scheduler

- Se activa con `FACTURAPP_SYNC_ENABLED=true`.
- Corre una vez por día a la hora configurada (UTC-3).
- Si el día ya tuvo una sincronización exitosa, no vuelve a ejecutar.
- Si la inicial no existe, registra `initial_required` y no consume créditos.
- Si el proceso arranca después de la hora programada, recupera la corrida del día.

### Recuperación

1. `GET /api/facturapp/runs` → ver `status`, `stop_reason`, `last_desde_id`.
2. `POST /api/facturapp/sync` sin cambios → reanuda automáticamente la corrida pendiente.
3. Si el estado quedó `failed` por credenciales/parámetros, corregir y reintentar.
4. Si el saldo no alcanza, ampliar el plan o reducir `maxPages`; el proceso se detiene antes de tocar la reserva.

### Logs

Cada corrida registra en `facturapp_sync_runs` y en el logger:

```text
[Facturapp] Inicio de sincronización { runId, mode, cutoff, desdeId, maxPages, creditsAvailable }
[Facturapp] Página procesada { runId, pages, received, inserted, updated, unchanged, creditsAvailable, nextDesdeId }
[Facturapp] Sincronización finalizada { runId, status, stopReason, pages, received, inserted, updated, creditsConsumed }
```

Nunca se registra la API key ni el header `Authorization`.

---

## 6. Reintentos y protección de créditos

- **429 / 500 / 503:** hasta 2 reintentos con backoff exponencial (1 s, 2 s), respetando `Retry-After` si existe.
- **401 / 403 / 400 / 402:** sin reintentos.
- **Timeout / error de red:** hasta 2 reintentos.
- Una sola solicitud activa a la vez (sin paralelismo).
- Antes de cada página se verifica `disponiblesMes - reserva >= 1`.
- No se consulta el saldo entre páginas: se usa `creditos.disponiblesMes` de cada respuesta.
- No se consultan productos individualmente cuando el listado ya trae precio y stock.
- El scheduler no hace polling: una vez al día.

---

## 7. Pruebas

`backend/tests/facturapp_sync.test.js` cubre:

- Mapeo de campos, moneda, fechas y stock.
- Campos ausentes conservados como `null` (no sobrescriben).
- Deduplicación por `id` y por código.
- Respuesta vacía (1 crédito).
- Múltiples páginas con `siguienteDesdeId`.
- Duplicados en la misma página.
- Error en página intermedia → `paused` + reanudación desde el último `desdeId`.
- Falta de créditos → no llama a la API.
- Inicial sin confirmación → `confirmation_required`.
- Incremental sin inicial → `initial_required`.
- Error 401 → `failed` con `requestId`, sin reintento.
- Paginación estancada → `failed`, no se declara exitosa.
- Reintento de 503 y no reintento de 401 en el cliente HTTP.
- Falta de `FACTURAPP_API_KEY` → error claro sin request.

Resultado: **19 tests** dentro de la suite total (**31 suites / 422 tests**).

---

## 8. Despliegue

1. Ejecutar `npm run migrate:up`.
2. Configurar `FACTURAPP_API_KEY` y `FACTURAPP_EXPECTED_ARTICLES` en el entorno del backend (nunca en Git).
3. Reiniciar el backend.
4. Verificar `GET /api/facturapp/status`.
5. Ejecutar `GET /api/facturapp/estimate?mode=initial` y confirmar que el costo entra en el saldo.
6. Lanzar la inicial con `confirmInitial=true` y `maxPages` igual al presupuesto disponible.
7. Activar `FACTURAPP_SYNC_ENABLED=true` para la incremental diaria.
8. Revisar `GET /api/facturapp/runs` después de la primera corrida.

> **No ejecutar la sincronización inicial sin antes definir `FACTURAPP_EXPECTED_ARTICLES` y validar el saldo.** El sistema se detiene solo, pero la estimación evita iniciar un proceso que no podrá completarse.

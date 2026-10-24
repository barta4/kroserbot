# Informe de entrega — Krosmart v2.3.12

**Fecha:** 24/10/2026  
**Estado:** listo para validación del cliente (no cerrar como aprobado hasta su OK)  
**Commit:** `PENDIENTE`
**Imagen:** `alfredobartaburu/krosmart:v2.3.12` y `:latest` (linux/amd64)
**Digest:** `PENDIENTE`

---

## 1. Resumen ejecutivo

Esta entrega cierra tres frentes:

1. **WhatsApp separado del resto de los canales.** WhatsApp responde en un solo mensaje, acotado a 300 caracteres, sin listas ni preguntas de seguimiento. Si no encuentra el producto, responde de forma determinista con dirección y teléfonos fijos, sin gastar una segunda ronda del LLM.
2. **Precisión de búsqueda.** Se corrigieron fallos estructurales que hacían que el bot dijera “no tenemos” con productos en catálogo: ñ, nombres concatenados, sinónimos, atributos incompatibles y relajación progresiva.
3. **Evaluación reproducible.** Se agregó `npm run search:eval` con un set de consultas reales de mostrador.

Resultado actual:
- **36 suites / 463 tests Jest en verde**.
- **15/15 hit@1 y hit@5** en el set de evaluación web.
- **2/2 ausencias correctas** (consultas que realmente no están en catálogo).

### Pulido visual del composer (v2.3.12)

Se corrigió el scrollbar nativo que aparecía dentro del cuadro de chat y se modernizó la caja de entrada:

- Scrollbar nativo reemplazado por uno fino (4 px) y sin flechas; sólo aparece cuando el texto supera el alto máximo.
- Textarea autoexpandible hasta 132 px; sin scrollbar cuando el campo está vacío.
- Caja de entrada con fondo degradado sutil, borde más limpio, foco amarillo y botón de envío más prolijo.
- Barra inferior con indicador verde y texto alineado a la izquierda.
- La píldora de “lista de materiales detectada” se redujo y acortó.
- Mismo tratamiento para el scrollbar del historial de mensajes.

---

## 2. Separación por canal

Archivo principal: `backend/services/channel/channelPolicy.js`.

| Aspecto | WhatsApp | Web / Instagram / otros |
|---|---|---|
| Mensajes por turno | **1** | 1 (puede fragmentarse si `message_chunking_enabled=true`) |
| Largo máximo | **300 caracteres** | 1600 caracteres |
| Listas / viñetas | Prohibidas | Permitidas (máx. 3 ítems) |
| Preguntas de seguimiento | Prohibidas | Permitidas |
| Resultado vacío | Dirección + teléfonos fijos | Directiva anterior de catálogo |
| Búsqueda relajada | **No** (coincidencia estricta) | **Sí** (puede ofrecer aproximados y pedir aclaración) |
| Segunda ronda del LLM con 0 resultados | **No** (respuesta determinista) | Sí |

### Mensaje fijo de WhatsApp

> Hola, no tenemos ese artículo en el catálogo. Consultá en Av. 8 de Octubre 3452 (La Unión) o llamá al 2508 3100 / 2509 7508.

Se puede personalizar con la clave de configuración `msg_sin_resultado_whatsapp`. Si el cliente también pregunta por pagos, envíos, horarios o pedidos, el fallback fijo no se aplica: responde el LLM para no tapar esa consulta.

### Detección del canal

El webhook resuelve el canal desde `conversation.channel`, `conversation.inbox.channel_type`, `payload.inbox.channel_type`, etc. Si el valor contiene `whatsapp` (por ejemplo `Channel::Whatsapp`) aplica la política estricta. Si Uruchat envía otro tipo de canal para WhatsApp, el bot usará la política estándar.

---

## 3. Precisión de búsqueda

### Problemas corregidos

| Problema | Impacto | Solución |
|---|---|---|
| La ñ no se normalizaba en SQL | 27 productos “CAÑO” invisibles al buscar “cano” | Función `krosmart_unaccent` + migración de índices |
| 32,8 % de nombres concatenados (1.159 productos) | El re-ranker no encontraba “corta”, “tubo”, “pvc” dentro de una palabra | Matching por substring para tokens de 4+ y sinónimos por frase |
| AND estricto de todos los tokens | “pintura latex blanco 20l” devolvía 0 aunque había látex | Relajación progresiva sólo en web |
| Sin penalización por atributo incompatible | “foco led 9w” devolvía 60W; “tornillo 8x50” devolvía 5x45 | Penalización por medida, dimensión, volumen, potencia y color |
| Sin sustantivo principal obligatorio | “caño pvc” devolvía botas de lluvia por “PVC” | Se exige el primer sustantivo núcleo o un sinónimo válido |
| Sinónimos encontrados pero descartados | “cortador de caño” no priorizaba la tijera correcta | Score contra la variante que encontró el producto + bonus de sinónimo |
| Prefijos genéricos | “caño” perdía contra “americano” | Búsqueda por prefijo del sustantivo principal |
| Vector sin control de umbral | Falsos positivos semánticos | `search_vector_threshold` configurable |

### Evaluación

```bash
npm run search:eval
```

Salida esperada (capa textual, sin vector):

| Métrica | Resultado |
|---|---:|
| Hit@1 | 15/15 (100 %) |
| Hit@5 | 15/15 (100 %) |
| Consultas sin resultados | 0/15 |
| Ausencias correctas | 2/2 |

> Importante: el set es una muestra de 17 consultas; no reemplaza una evaluación con el cliente. La capa vectorial no se incluyó porque los embeddings actuales de la base local tienen norma ~16,97 (compatibles con vectores mock). Antes de confiar en la búsqueda semántica hay que reindexar con un proveedor real.

---

## 4. Archivos principales modificados

| Archivo | Cambio |
|---|---|
| `backend/services/channel/channelPolicy.js` | Nuevo: políticas por canal, clamp y mensaje fijo |
| `backend/services/webhook/promptBuilder.js` | Reglas de prompt por canal |
| `backend/services/webhook/toolExecutor.js` | Directivas WhatsApp, `respuesta_cerrada`, `aproximado` |
| `backend/services/llm/llmService.js` | Corta la segunda ronda en WhatsApp con búsqueda vacía |
| `backend/services/webhook/webhookService.js` | Resuelve canal, fuerza 1 mensaje y clamp |
| `backend/controllers/cotibotController.js` | Política web + `filterOutput` |
| `backend/services/search/searchService.js` | Relajación, prefijos, umbral y procedencia |
| `backend/services/search/reranker.js` | Matching concatenado, atributos, núcleo y sinónimos |
| `backend/repositories/productosRepository.js` | `krosmart_unaccent`, prefijo y relajación OR |
| `backend/repositories/guiasTecnicasRepository.js` | Normalización con ñ |
| `db/migrations/1786215600000_enye_normalization.sql` | Función e índices |
| `scripts/eval-search.js` + `scripts/search-golden.json` | Evaluación reproducible |
| `backend/tests/channel_policy.test.js` | Cobertura de políticas |
| `backend/tests/search_precision.test.js` | Cobertura de precisión |
| `backend/tests/whatsapp_channel.test.js` | Fallback y una sola ronda |
| `backend/tests/message_splitter.test.js` | WhatsApp no fragmenta |
| `public/css/landing-v2.css` | Composer moderno, scrollbars finos |
| `public/js/app.js` | Auto-grow y control de overflow |
| `public/js/chatWidget.js` | Placeholder contextual y refresh del alto |
| `public/index.html` | Píldora de lista más corta |
| `backend/controllers/configuracionController.js` | `search_vector_threshold` habilitado |

---

## 5. Despliegue en Dokploy

La imagen ya está publicada. El compose de producción debe incluir:

```yaml
image: alfredobartaburu/krosmart:v2.3.11
```

### Correcciones necesarias en el compose de producción

1. **Variables Facturapp:** el compose actual no las declara en `backend.environment`. En Docker Compose las variables del panel se usan para interpolar; si no están declaradas, no llegan al contenedor. Agregar:

```yaml
      - FACTURAPP_API_KEY=${FACTURAPP_API_KEY}
      - FACTURAPP_API_URL=${FACTURAPP_API_URL:-https://mcp.facturapp.com.uy}
      - FACTURAPP_SYNC_ENABLED=${FACTURAPP_SYNC_ENABLED:-false}
      - FACTURAPP_SYNC_HOUR=${FACTURAPP_SYNC_HOUR:-4}
      - FACTURAPP_SYNC_MINUTE=${FACTURAPP_SYNC_MINUTE:-0}
      - FACTURAPP_SYNC_RESERVE_CREDITS=${FACTURAPP_SYNC_RESERVE_CREDITS:-5}
      - FACTURAPP_SYNC_MAX_PAGES=${FACTURAPP_SYNC_MAX_PAGES:-40}
      - FACTURAPP_EXPECTED_ARTICLES=${FACTURAPP_EXPECTED_ARTICLES}
      - FACTURAPP_SYNC_EMBEDDINGS=${FACTURAPP_SYNC_EMBEDDINGS:-true}
      - FACTURAPP_SYNC_PARTIAL_PAGE_COMPLETES=${FACTURAPP_SYNC_PARTIAL_PAGE_COMPLETES:-true}
```

2. **Secretos:** definir en Dokploy `POSTGRES_PASSWORD`, `JWT_SECRET`, `ENCRYPTION_KEY`, `ADMIN_PASSWORD` y `WEBHOOK_BASIC_AUTH`. No usar los defaults públicos del compose.
   - Si se cambia `POSTGRES_PASSWORD` sobre un volumen ya inicializado, hay que ejecutar `ALTER USER kroser WITH PASSWORD '...'` dentro de Postgres.
   - Si se cambia `ENCRYPTION_KEY`/`JWT_SECRET`, los valores cifrados en la base (por ejemplo `llm_api_key`) pueden quedar ilegibles. Definir `ENCRYPTION_KEY` estable y no rotarlo sin reingresar esos valores.
3. **Scraper:** `command: tail -f /dev/null` + `restart: unless-stopped` anula el scraping programado. Para el esquema del repo usar `restart: "no"` sin `command` y cron `docker start kroserbot-scraper`; o mantenerlo vivo pero ejecutar el scraper manualmente con `docker exec`.
4. **Rotar `FACTURAPP_API_KEY`:** la clave actual quedó expuesta en una captura. Rotarla en Facturapp y actualizarla en Dokploy.
5. **Verificar el canal WhatsApp:** si el inbox no envía `Channel::Whatsapp`, la política estricta no se activa.

### Migración

La imagen ejecuta `node db/migrate.js up` al arrancar. La migración `1786215600000_enye_normalization.sql` crea `krosmart_unaccent` y recrea los índices trigram. Es no destructiva, pero conviene hacer backup del volumen `kroserbot_postgres_data` antes del redeploy.

---

## 6. Verificación post-deploy

```bash
# Salud
curl -fsS https://<dominio>/api/health

# Migración aplicada
docker exec krosermart-postgres psql -U kroser -d kroserbot \
  -c "select proname from pg_proc where proname='krosmart_unaccent';"

# Ñ funcionando
docker exec krosermart-postgres psql -U kroser -d kroserbot \
  -c "select count(*) from productos where krosmart_unaccent(nombre) ilike '%caño%';"
```

Pruebas funcionales:

| Canal | Prueba | Resultado esperado |
|---|---|---|
| WhatsApp | “varilla de 16” | Un solo mensaje con Av. 8 de Octubre 3452 y 2508 3100 / 2509 7508 |
| WhatsApp | “caño pvc 1/2” | Si no hay coincidencia exacta, contacto fijo |
| WhatsApp | Cualquier respuesta | Máximo 300 caracteres y un solo mensaje |
| Web | “pintura latex blanco 20l” | Prioriza un látex; puede pedir aclaración si falta color/volumen |
| Web | “cortador de caño” | Prioriza la tijera corta tubo PVC |
| Web | Iniciar chat y volver al catálogo | El catálogo no queda vacío por la conversación |

---

## 7. Prueba controlada de Facturapp (2 páginas)

Procedimiento completo en `FACTURAPP_SYNC.md`, sección **“Prueba controlada de 2 páginas”**.

Resumen:
1. Poner `FACTURAPP_SYNC_ENABLED=false` temporalmente (el scheduler podría retomar la corrida pendiente con hasta 40 páginas).
2. En el panel de Facturapp, poner **“Páginas máx.” = 2**.
3. Click en **“Sincronizar inicial”** y confirmar.
4. La corrida queda `paused` con `stopReason=max_pages`, `pending_mode=initial` y `pending_desde_id`.
5. Verificar historial y SQL.
6. Para continuar, poner páginas en 40 y volver a “Sincronizar inicial”; retoma desde el cursor.

---

## 8. Pendientes y riesgos conocidos

Estos puntos **no bloquean la aprobación funcional**, pero deben quedar visibles:

| Prioridad | Pendiente | Impacto |
|---|---|---|
| Alta | Reindexar embeddings con proveedor real y registrar modelo | La búsqueda vectorial actual no es confiable; la textual ya está corregida |
| Alta | Aplicar correcciones del compose (Facturapp, secretos, scraper) | Sin Facturapp en `environment`, la sincronización no corre |
| Alta | Rotar `FACTURAPP_API_KEY` expuesta | Seguridad |
| Media | Tercera ronda de tool calling / reintento de búsqueda | El LLM no puede reformular una búsqueda fallida |
| Media | Paridad del chat web: dedup, idempotencia y `DERIVAR` | Inconsistencia entre canales |
| Media | Descuentos dinámicos por categoría en `pricingCalculator` | Presupuestos pueden no reflejar la configuración del admin |
| Baja | Revisar `restart` del scraper y cron | Scraping programado no corre con `tail -f /dev/null` |

---

## 9. Criterios de aceptación del cliente

- [ ] Landing web: hero, Cotibot, catálogo, promociones, locales y footer.
- [ ] Catálogo sigue funcionando después de iniciar una conversación con el agente.
- [ ] WhatsApp: una sola burbuja por respuesta y mensajes acotados.
- [ ] WhatsApp: producto inexistente → dirección/teléfono fijos.
- [ ] Web: consultas ambigüas pueden pedir aclaración u ofrecer alternativas.
- [ ] Búsquedas de muestra: caño, cortador de caño, látex, membrana, foco, tornillo, zapatilla.
- [ ] Facturapp: prueba de 2 páginas y reanudación.
- [ ] Composer: sin scrollbar nativo, textarea autoexpandible y estética aprobada.
- [ ] Panel admin: estado de Facturapp, créditos y historial.
- [ ] Aprobación explícita del cliente para continuar con las fases pendientes.

---

*Documento de cierre operativo. No se deben iniciar cambios funcionales nuevos hasta la aprobación del cliente.*

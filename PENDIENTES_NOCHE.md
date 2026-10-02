# 🌙 Bitácora de Cierre y Guía de Operaciones — Kroserbot v2.1.6

Este documento resume la totalidad de causas analizadas, diagnósticos de raíz, soluciones arquitectónicas implementadas, suites de pruebas y el estado listo para producción al cierre de la jornada en **v2.1.6**.

---

## 🚀 1. Resumen Ejecutivo de Versiones Desplegadas

| Versión | Foco de la Solución | Estado |
|---|---|---|
| **v2.0.0** | Desestructuración de URLs de Mercado Libre/Kroser (`urlInterpreterService`), bypass de mock embeddings y asignación de agentes en Uruchat. | ✅ Desplegado |
| **v2.1.0** | Búsqueda Híbrida RRF (Reciprocal Rank Fusion k=60) combinando búsqueda léxica multitérmino + vectorial con embeddings reales. | ✅ Desplegado |
| **v2.1.1** | Expansión léxica con sinónimos ferreteros uruguayos (`LOCAL_SYNONYMS`) y re-ranker con penalización de categorías cruzadas. | ✅ Desplegado |
| **v2.1.2** | Enriquecedor de consultas (`queryAnalyzer.js`), evitando que el LLM degrade modelos específicos (ej: "Alpha-Pro 1600W") a categorías genéricas. | ✅ Desplegado |
| **v2.1.3** | Tagging Dokploy y sinónimos para asadores/parrillas (`parrillero`/`parrillera`). Verificado en vivo vía API remota. | ✅ Desplegado |
| **v2.1.4** | Migración SQL para reactivar productos discontinuados con stock (`1786214800000_reactivate_catalog_products.sql`) y desambiguación de "cueritos" de canilla vs. válvulas de gas. | ✅ Desplegado |
| **v2.1.5** | **Protocolo Híbrido Inteligente:** Detección de rechazo de opciones (`rechazo_producto`) y reclamos (`reclamo`), prohibición de venta invasiva y directivas para derivación o teléfonos de sucursales. | ✅ Desplegado |
| **v2.1.6** | Integración de los teléfonos oficiales de la **Central de Reclamos** (**`2218 5987 / 2218 5988`**) en prompt, derivaciones Uruchat y respuestas de asistencia. | ✅ **Versión Final de Cierre** |

---

## 🔍 2. Diagnóstico de Incidentes y Soluciones de Raíz

### Caso 1: Enlaces de Mercado Libre ("Ze-Sergio" - Paneles WPC)
* **Causa**: El webhook recibía el link crudo de Mercado Libre, buscaba la palabra suelta "panel" y devolvía paneles LED de iluminación.
* **Solución**: `urlInterpreterService.js` extrae el slug semántico de la URL de Mercado Libre y la inyecta al prompt. Si Kroser no lo comercializa, aclara con honestidad y activa `DERIVAR: ecommerce`.

### Caso 2: Búsqueda de Pinturas devolvía Mechas de Taladro
* **Causa**: Vectores senoidales ficticios (*mock embeddings*) con similitud artificial de ~0.9999 hacia la categoría mayoritaria (`Herramientas`).
* **Solución**: `embeddingProvider.js` lee dinámicamente las credenciales activas de Gemini (`text-embedding-004`), desactiva automáticamente vectores simulados en `searchVector` y aplica filtro estricto de coherencia.

### Caso 3: "HIDROLAVADORA ALPHA-PRO 1600W tenes"
* **Causas**: 
  1. El LLM sobre-generalizaba el término a `"hidrolavadora"`, perdiendo la marca Alpha-Pro.
  2. En la base de datos remota, el SKU `820HL7125M2` tenía `discontinuado = TRUE`.
* **Solución**:
  - `queryAnalyzer.js` intercepta la query del LLM y la restituye con el modelo exacto consultado por el usuario.
  - Migración `db/migrations/1786214800000_reactivate_catalog_products.sql` que al iniciar el contenedor reactiva productos que tienen stock real.

### Caso 4: "cueritos de canilla" devolvía válvulas de gas y mascarillas
* **Causa**: En `LOCAL_SYNONYMS`, `"cuerito"` incluía `"valvula"`, atrayendo válvulas de supergás Dinamarquesa y mascarillas FFP2 con válvula de exhalación.
* **Solución**: Se eliminó `"valvula"` del sinónimo de cueritos, mapeándose exclusivamente a sanitaria (`canilla`, `grifo`, `griferia`), y se añadió en `reranker.js` una penalización de -35 puntos si una consulta de sanitaria se mezcla con gas o mascarillas.

### Caso 5: Reclamos y Rechazo de Productos ("no quiero esa que me pasaste" / 0 productos)
* **Causa**: El bot estaba instruido para vender siempre; si el cliente se quejaba o rechazaba una opción, insistía ofreciendo otros artículos o quedaba en un callejón sin salida.
* **Solución**:
  - `intentDetector.js`: Se incorporaron `REJECTION_PATTERNS` (`rechazo_producto`) y se ampliaron `COMPLAINT_PATTERNS` (`reclamo`).
  - `promptBuilder.js`: Prohibición estricta de insistir con ventas ante reclamos o rechazo explícito.
  - `webhookService.js`: Soporte para derivación con `/DERIVAR:\s*(\w+)/i` y adjunción automática de teléfonos de contacto.
  - `toolExecutor.js`: Directiva no invasiva (`EMPTY_SEARCH_DIRECTIVE`) cuando el catálogo arroja 0 coincidencias.

### Caso 6: Teléfonos Oficiales de Atención y Reclamos
* **Configuración aplicada**:
  - **Central de Reclamos:** **`2218 5987 / 2218 5988`**
  - **Sucursales Físicas:** Disponibles vía tool `buscar_sucursales` (Centro: `2900 1122`, Portones: `2601 0000`, Pocitos: `2708 3344`, Carrasco: `2600 5566`, Ciudad de la Costa: `2682 7788`).

---

## 📋 3. Guía de Operaciones en el Servidor (Dokploy)

Al retomar la operativa:

1. **Ingreso a Dokploy**:
   - Abrir el panel de Dokploy.
   - Ir al servicio **kroserbot-backend**.
2. **Imagen a Desplegar**:
   - Comprobar que apunte a la versión recién compilada:
     ```text
     alfredobartaburu/kroserbot:v2.1.6
     ```
     *(O alternativamente `:latest`, ya que ambas están sincronizadas en Docker Hub).*
3. **Pulsar Deploy / Redeploy**.
4. **Verificación de Salud**:
   - Abrir: `https://venta.urufile.duckdns.org/api/health` ➔ Debe responder `200 OK`.
5. **Prueba en Vivo**:
   - Probar consultas en el chat de Uruchat o en el panel admin:
     - *"Tengo un reclamo, la hidrolavadora vino fallada"* ➔ El bot se disculpa cordialmente, proporciona `2218 5987 / 2218 5988` y deriva a administración.
     - Consulta de artículo no comercializado ➔ El bot informa con honestidad que no está en catálogo web y ofrece los teléfonos de Central o derivar con un asesor.

---

## 🧪 4. Estado de Pruebas Automatizadas

Antes de dar por cerrado el turno, todas las suites de pruebas pasaron al 100% en verde:

```bash
# 21 suites de Jest (282 tests) — Backend API, Webhooks, LLM Fail-Safe, RRF, Intents
PASS backend/tests/humanization.test.js
PASS backend/tests/tool_executor.test.js
PASS backend/tests/system_audit_improvements.test.js
PASS backend/tests/llm_failsafe.test.js
PASS backend/tests/derivation_assignment_and_labels.test.js
... (21 suites passed, 282 passed)

# 22 tests de Pytest — Scraper de Catálogo Python
22 passed in 3.19s
```

---

*Fin de jornada. Código sincronizado en GitHub `main` y Docker Hub listo en `v2.1.6`.*

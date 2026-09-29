# 🌙 Guía de Mantenimiento y Verificación para la Noche — Kroserbot v1.9.9

Este documento resume las causas analizadas, todas las mejoras implementadas en la versión **v1.9.9** y el paso a paso exacto a ejecutar esta noche en Dokploy y en el servidor.

---

## 🔍 1. Diagnóstico de los Incidentes de Producción

### Caso A: Cliente "Ze-Sergio" (Consulta por Paneles WPC vía link de Mercado Libre)
* **Qué ocurrió**: El cliente envió el enlace de Mercado Libre de paneles decorativos de pared WPC. El bot no interpretaba URLs, tomó como fallback la palabra aislada `"panel"` y buscó en catálogo, recomendando *"PANEL LED"* (luminarias de techo). Luego, ante la réplica del cliente, el LLM generó una respuesta vacía tras la ejecución de herramientas y cayó 3 veces seguidas en frases robóticas de contingencia (`"¿En qué más te puedo ayudar?"` / `"Por el momento no contamos con stock..."`) sin derivar a un asesor humano.
* **Causa raíz**:
  1. Falta de un módulo de desestructuración de URLs de e-commerce en el pipeline de webhooks.
  2. Búsqueda léxica genérica (`"panel"` coincidió con paneles de iluminación).
  3. Ausencia de regla de prompt para derivar al área de e-commerce cuando el cliente consulta por artículos o condiciones de una publicación externa.

### Caso B: Pintura ➔ Mechas (Pide pintura y el bot ofrece brocas/mechas de taladro)
* **Qué ocurrió**: Al pedir pintura, el buscador RAG devolvía mechas y herramientas pesadas.
* **Causa raíz**:
  1. En la base de datos PostgreSQL, los 3.390 productos tenían **mock embeddings** (vectores senoidales ficticios).
  2. Al calcular la distancia coseno contra un vector simulado, cualquier texto producía una similitud artificial de ~0.9999 contra la categoría más grande del catálogo (`Herramientas`, que concentra el 58% de los productos con 2.046 ítems).
  3. El proveedor de embeddings (`embeddingProvider.js`) intentaba obligatoriamente OpenAI primero y fallaba si la API key era de Gemini o un proxy sin credenciales OpenAI, retrocediendo siempre a mock embeddings en lugar de usar la clave activa de Gemini.

---

## 🛠️ 2. Mejoras y Soluciones Implementadas en v1.9.9

1. **Nuevo Servicio de Interpretación de Enlaces (`urlInterpreterService.js`)**:
   - Detecta y analiza URLs entrantes de **Mercado Libre**, **Kroser** y cualquier tienda online.
   - Extrae el slug descriptivo de la URL (ej: `panel-wpc-decorativo-revestimiento-pared-wall-panel` ➔ `"Panel wpc decorativo revestimiento pared wall panel"`).
   - Consulta metadatos OpenGraph/HTML con timeout rápido de 2.5s y escudo anti-bloqueo (ignora títulos genéricos como `"Mercado Libre"` y prioriza el slug real del producto).
2. **Integración Transparente en el Webhook (`webhookService.js` Paso 7b)**:
   - Todo mensaje con enlaces se enriquece automáticamente:  
     `[Enlace analizado de Mercado Libre: Producto "Panel Wpc Decorativo Revestimiento Pared Wall Panel" (URL: ...)]`.
3. **Nueva Regla de Negocio en el Prompt del Sistema (`promptBuilder.js`)**:
   - **Regla 5 (Enlaces y publicaciones externas)**: El bot busca el producto exacto con `buscar_productos`. Si Kroser no lo vende o el cliente pregunta por stock/envíos de dicha publicación de Mercado Libre, el bot lo aclara amablemente y deriva a `DERIVAR: ecommerce`.
4. **Blindaje de Búsqueda RAG y Coherencia de Categorías (`toolExecutor.js`)**:
   - Omite automáticamente la búsqueda vectorial (`searchVector`) si los embeddings son simulados (`isMock: true`), evitando que los vectores falsos contaminen las búsquedas de texto.
   - Filtro de coherencia estricta para pinturas/impermeabilizantes: bloquea la infiltración de herramientas/mechas si la consulta era sobre pinturas.
5. **Proveedor de Embeddings Multi-Proveedor Dinámico (`embeddingProvider.js`)**:
   - Ahora lee la configuración activa de la base de datos (`llm_provider`, `llm_api_key`, `llm_fallback_provider`, `llm_fallback_api_key`).
   - Al tener **Google Gemini** como proveedor principal en el panel admin, genera embeddings reales de alta fidelidad con **`text-embedding-004`**, con conmutación fail-safe a OpenAI `text-embedding-3-small`.
6. **Pruebas y Releases**:
   - Nueva suite de pruebas unitarias: `backend/tests/url_interpreter.test.js` (9 tests en verde).
   - Total verificado: **19 suites de Jest (238 tests)** y **22 tests de Python (Scraper)** pasando al 100%.
   - Imagen Docker compilada para `linux/amd64` y publicada en Docker Hub:
     - `alfredobartaburu/kroserbot:v1.9.9`
     - `alfredobartaburu/kroserbot:latest`
   - Código sincronizado con GitHub `main` (commit `c54e099`).

---

## 📋 3. Lista de Tareas para la Noche (Paso a Paso)

### Paso 1: Actualizar y Desplegar en Dokploy
1. Ingresar a Dokploy: `http://192.168.1.X:3000` (o por dominio local).
2. Ir al servicio **kroserbot-backend**.
3. Verificar que la imagen apunte a:
   ```
   alfredobartaburu/kroserbot:v1.9.9
   ```
4. Pulsar **Deploy / Redeploy**.

### Paso 2: Verificar Estado de Salud
1. Abrir en el navegador:
   ```
   https://venta.urufile.duckdns.org/api/health
   ```
2. Verificar que devuelva estado `200 OK`.
3. *(Opcional)* Si Redis aún muestra `"redis":"memory_fallback"`, revisar en las variables de entorno de Dokploy que `REDIS_URL=redis://redis:6379` o `REDIS_HOST=redis` y que ambos contenedores compartan la red `kroserbot-network`.

### Paso 3: Prueba E2E en el Simulador de Chat del Panel Admin
1. Ingresar al panel admin: `https://venta.urufile.duckdns.org/admin/` (o localhost).
2. Ir a la pestaña **Simulador de Chat**.
3. Enviar el mensaje que falló originalmente:
   ```
   Hola! https://www.mercadolibre.com.uy/panel-wpc-decorativo-revestimiento-pared-wall-panel/up/MLUU4824517083 tienen este panel?
   ```
4. **Resultado esperado**:
   - El bot identificará que se trata de *"panel wpc decorativo revestimiento pared"*.
   - Buscará en catálogo sin confundirse con luminarias LED.
   - Si no hay paneles WPC en stock, responderá con empatía ferretera y ofrecerá transferir con un asesor de e-commerce (`DERIVAR: ecommerce`).

### Paso 4: (Opcional) Re-indexar Embeddings Reales de Gemini en Catálogo
* Si se desea sustituir de una sola vez los vectores simulados en la base de datos de producción por vectores reales de Gemini:
  ```bash
  # Desde la terminal del servidor o dentro del contenedor backend:
  node backend/services/embeddings/generateEmbeddings.js
  ```
  *(El script ahora usará la API Key de Gemini configurada y poblará vectores reales de 768 dimensiones).*

### Paso 5: Seguridad del Servidor (Cierre de Puerto 3000)
1. Entrar al panel del router de casa (`192.168.1.1`).
2. En **Reenvío de Puertos (Port Forwarding)**, desactivar o borrar la regla que expone el puerto `3000` a Internet.
3. Mantener abiertos únicamente los puertos `80` y `443` (Traefik / HTTPS).

---

*Documentación lista y consolidada para la sesión nocturna.*

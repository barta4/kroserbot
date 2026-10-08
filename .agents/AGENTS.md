# Reglas y Directrices para Agentes — Kroserbot

Consulta el archivo maestro completo en la raíz del repositorio: [`AGENTS.md`](../AGENTS.md).

### Reglas Críticas Rápidas:
1. **Rebranding**: En `admin/index.html` y cara al usuario, NUNCA usar la palabra "Chatwoot", siempre **Uruchat**.
2. **Cifrado**: `backend/utils/cryptoUtils.js` exige `ENCRYPTION_KEY` o `JWT_SECRET`. No usar fallbacks débiles.
3. **Optimización**: Usar `configuracionRepo.getMultiple([...])` para evitar N+1 queries.
4. **Módulos comunes**: Usar `crossSellingMap.js`, `formatCurrency.js`, `textNormalizer.js` y `secretKeys.js`.
5. **Multimodal**: Audios WhatsApp (`.opus`/`.oga`) e Imágenes (`analyzeImage`) se envían en Base64 con fail-safe bidireccional Gemini <-> OpenAI.
6. **Scraper en Dokploy/Easypanel**: `restart: "no"`. Se programa con cron `0 3 * * * docker start kroserbot-scraper`.
7. **Tests obligatorios**: `npm test` (326 tests) y `npm run test:python` (22 tests) deben pasar al 100%.
8. **Docker Hub**: `alfredobartaburu/kroserbot` con versión incremental (`v2.2.0`) y dual-tag `:latest`.

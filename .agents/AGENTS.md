# Reglas y Directrices para Agentes — Kroserbot

Consulta el archivo maestro completo en la raíz del repositorio: [`AGENTS.md`](../AGENTS.md).

### Reglas Críticas Rápidas:
1. **Rebranding**: En `admin/index.html` y cara al usuario, NUNCA usar la palabra "Chatwoot", siempre **Uruchat**.
2. **Cifrado**: `backend/utils/cryptoUtils.js` exige `ENCRYPTION_KEY` o `JWT_SECRET`. No usar fallbacks débiles.
3. **Optimización**: Usar `configuracionRepo.getMultiple([...])` para evitar N+1 queries.
4. **Módulos comunes**: Usar `crossSellingMap.js`, `formatCurrency.js`, `textNormalizer.js` y `secretKeys.js`.
5. **Tests obligatorios**: `npm test` (202 tests) y `npm run test:python` (22 tests) deben pasar al 100%.
6. **Docker Hub**: `alfredobartaburu/kroserbot` con versión incremental (`v1.7`) y dual-tag `:latest`.

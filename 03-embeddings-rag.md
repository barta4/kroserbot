# Tarea 03 — Embeddings / RAG

## Objetivo
Que el bot pueda encontrar productos relevantes según lo que escribe el cliente, sin tener que mandarle todo el catálogo al LLM.

## Tareas
- [ ] Generar embedding solo de productos **nuevos o modificados** desde el último scraping (no reprocesar todo cada vez)
- [ ] Texto a embeber: nombre + categoría + marca + descripción (concatenados)
- [ ] Batch de embeddings (varios productos por llamada a la API) para bajar costo y tiempo
- [ ] Job programado (cron), separado del scraper: primero corre el scraper, después este job de embeddings
- [ ] Función de búsqueda semántica: dado un mensaje del cliente, devolver top 5 productos, con umbral mínimo de similitud (si no hay nada suficientemente relevante, no devolver productos inventados/forzados)
- [ ] Excluir productos `discontinuado = true` de la búsqueda
- [ ] Test: con 3-5 mensajes de ejemplo reales ("necesito una pintura para exterior", "tienen taladros Bosch"), verificar que los resultados son coherentes

## Criterio de terminado
Una búsqueda de prueba devuelve productos relevantes y reales (existentes en la tabla `productos`) en menos de 1 segundo.

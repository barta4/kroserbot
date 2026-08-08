const embeddingProvider = require('./embeddingProvider');
const productosRepo = require('../../repositories/productosRepository');
const localesRepo = require('../../repositories/localesRepository');

const SIMILARITY_THRESHOLD = 0.3; // Minimum cosine similarity to avoid unrelated products

module.exports = {
  async getRelevantContext(queryText) {
    let productos = [];
    let locales = [];

    try {
      // 1. Generate Query Vector Embedding
      const queryEmbedding = await embeddingProvider.generateSingleEmbedding(queryText);

      // 2. Perform Vector Search on active products
      if (queryEmbedding && queryEmbedding.length > 0) {
        const rawResults = await productosRepo.searchVector(queryEmbedding, 5);
        // Filter out results below similarity threshold
        productos = rawResults.filter((p) => (p.similarity === undefined || p.similarity >= SIMILARITY_THRESHOLD));
      }

      // Fallback to keyword search if vector search returns no results
      if (productos.length === 0) {
        productos = await productosRepo.searchByKeyword(queryText, 5);
      }

      // 3. Search Store Locations if store-related terms present
      const lowerQ = queryText.toLowerCase();
      if (
        lowerQ.includes('local') ||
        lowerQ.includes('sucursal') ||
        lowerQ.includes('horario') ||
        lowerQ.includes('direccion') ||
        lowerQ.includes('donde') ||
        lowerQ.includes('abierto') ||
        lowerQ.includes('telefono')
      ) {
        locales = await localesRepo.getAll();
      }
    } catch (err) {
      console.warn(`[RAG Search Warning] ${err.message}. Falling back to keyword search.`);
      try {
        productos = await productosRepo.searchByKeyword(queryText, 5);
      } catch (_e) {}
    }

    // 4. Format Prompt Context
    let contextStr = '';

    if (productos.length > 0) {
      contextStr += 'PRODUCTOS RELEVANTES ENCONTRADOS EN CATÁLOGO:\n';
      productos.forEach((p) => {
        const precioText = p.precio_oferta ? `$${p.precio_oferta} (Oferta, Normal: $${p.precio})` : `$${p.precio}`;
        contextStr += `- SKU: ${p.sku} | ${p.nombre} | Marca: ${p.marca || 'N/A'} | Precio: ${precioText} | Stock: ${p.stock_status}\n`;
        if (p.descripcion) contextStr += `  Descripción: ${p.descripcion.substring(0, 150)}...\n`;
      });
      contextStr += '\n';
    } else {
      contextStr += 'PRODUCTOS ENCONTRADOS EN CATÁLOGO: Ninguno con suficiente relevancia para la consulta.\n\n';
    }

    if (locales.length > 0) {
      contextStr += 'SUCURSALES Y LOCALES KROSER:\n';
      locales.forEach((l) => {
        contextStr += `- ${l.nombre} (${l.zona}): ${l.direccion} | Tel: ${l.telefono} | Horario: ${l.horario}\n`;
      });
      contextStr += '\n';
    }

    return {
      contextStr,
      productosEncontrados: productos,
      localesEncontrados: locales,
    };
  },
};

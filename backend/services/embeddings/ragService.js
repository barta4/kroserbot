const embeddingProvider = require('./embeddingProvider');
const productosRepo = require('../../repositories/productosRepository');
const localesRepo = require('../../repositories/localesRepository');

const SIMILARITY_THRESHOLD = 0.45; // Increased cosine similarity threshold to reduce noise

// Cross-selling category mapping dictionary
const CROSS_SELLING_MAP = {
  pintura: ['pincel', 'rodillo', 'cinta', 'lija', 'bandeja'],
  taladro: ['broca', 'mecha', 'disco', 'proteccion'],
  herramienta: ['guante', 'disco', 'organizador'],
  impermeabilizante: ['malla', 'rodillo', 'sellador'],
};

module.exports = {
  async getRelevantContext(queryText) {
    let productos = [];
    let alternativas = [];
    let complementarios = [];
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

      // 3. Smart Substitution for Out-of-Stock Products
      const outOfStockItem = productos.find((p) => p.stock_status === 'out_of_stock');
      if (outOfStockItem || productos.length === 0) {
        const targetCategory = outOfStockItem ? outOfStockItem.categoria : queryText;
        const targetBrand = outOfStockItem ? outOfStockItem.marca : '';
        alternativas = await productosRepo.getAlternatives({
          categoria: targetCategory,
          marca: targetBrand,
          excludeSku: outOfStockItem ? outOfStockItem.sku : '',
          limit: 3,
        });
      }

      // 4. Cross-Selling / Complementary Products Suggestion
      if (productos.length > 0) {
        const categoriesFound = productos.map((p) => `${p.categoria || ''} ${p.nombre || ''}`.toLowerCase()).join(' ');
        const matchedComplementaryTerms = new Set();

        Object.keys(CROSS_SELLING_MAP).forEach((key) => {
          if (categoriesFound.includes(key)) {
            CROSS_SELLING_MAP[key].forEach((term) => matchedComplementaryTerms.add(term));
          }
        });

        if (matchedComplementaryTerms.size > 0) {
          complementarios = await productosRepo.getComplementaryItems(Array.from(matchedComplementaryTerms), 3);
        }
      }

      // 5. Search Store Locations if store-related terms present
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

    // 6. Format Prompt Context
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
      contextStr += 'PRODUCTOS ENCONTRADOS EN CATÁLOGO: Ninguno con suficiente relevancia directa para la consulta.\n\n';
    }

    if (alternativas.length > 0) {
      contextStr += 'ALTERNATIVAS RECOMENDADAS CON STOCK (Para ofrecer si el producto principal está agotado o no disponible):\n';
      alternativas.forEach((p) => {
        const precioText = p.precio_oferta ? `$${p.precio_oferta} (Oferta)` : `$${p.precio}`;
        contextStr += `- SKU: ${p.sku} | ${p.nombre} | Marca: ${p.marca || 'N/A'} | Precio: ${precioText} | Stock: ${p.stock_status}\n`;
      });
      contextStr += '\n';
    }

    if (complementarios.length > 0) {
      contextStr += 'SUGERENCIAS DE VENTA CRUZADA (CROSS-SELLING - Para ofrecer amablemente como complemento):\n';
      complementarios.forEach((p) => {
        const precioText = p.precio_oferta ? `$${p.precio_oferta} (Oferta)` : `$${p.precio}`;
        contextStr += `- SKU: ${p.sku} | ${p.nombre} | Precio: ${precioText}\n`;
      });
      contextStr += '\n';
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
      alternativasEncontradas: alternativas,
      complementariosEncontrados: complementarios,
      localesEncontrados: locales,
    };
  },
};

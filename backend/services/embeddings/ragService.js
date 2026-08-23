const db = require('../../config/db');
const embeddingProvider = require('./embeddingProvider');
const productosRepo = require('../../repositories/productosRepository');
const localesRepo = require('../../repositories/localesRepository');

const SIMILARITY_THRESHOLD = 0.35; // Calibrated cosine similarity threshold for pgvector

// Cross-selling category mapping dictionary
const CROSS_SELLING_MAP = {
  pintura: ['pincel', 'rodillo', 'cinta', 'lija', 'bandeja', 'aguarras', 'fijador', 'enduido'],
  yeso: ['perfil', 'solera', 'montante', 'tornillo', 'masilla', 'cinta', 'lija'],
  placa: ['perfil', 'masilla', 'cinta', 'tornillo'],
  drywall: ['perfil', 'tornillo', 'masilla', 'cinta'],
  porcelanato: ['adhesivo', 'pegamento', 'pastina', 'cruceta', 'llana', 'nivelador'],
  ceramica: ['adhesivo', 'pastina', 'cruceta', 'llana', 'esponja'],
  adhesivo: ['llana', 'pastina', 'esponja', 'cruceta'],
  taladro: ['broca', 'mecha', 'disco', 'guante'],
  impermeabilizante: ['malla', 'rodillo', 'sellador', 'fijador'],
  sanitaria: ['teflon', 'adhesivo pvc'],
  electricidad: ['cinta aisladora', 'buscapolo', 'cable'],
};

module.exports = {
  async getRelevantContext(queryText) {
    let productos = [];
    let alternativas = [];
    let complementarios = [];
    let locales = [];
    let zonasEnvio = [];
    let formasPago = [];

    const lowerQ = (queryText || '').toLowerCase();

    try {
      // 1. Keyword / Token Search (Direct Lexical Hits)
      const keywordResults = await productosRepo.searchByKeyword(queryText, 5);

      // 2. Vector Semantic Search (pgvector)
      let vectorResults = [];
      try {
        const queryEmbedding = await embeddingProvider.generateSingleEmbedding(queryText);
        if (queryEmbedding && queryEmbedding.length > 0) {
          const rawVector = await productosRepo.searchVector(queryEmbedding, 5);
          vectorResults = rawVector.filter((p) => (p.similarity !== undefined && p.similarity >= 0.52));
        }
      } catch (_vErr) {}

      // 3. Fusion & Deduplication (Lexical direct matches prioritized over semantic matches)
      const seenSkus = new Set();
      productos = [];

      for (const item of [...keywordResults, ...vectorResults]) {
        if (!seenSkus.has(item.sku)) {
          seenSkus.add(item.sku);
          productos.push(item);
        }
        if (productos.length >= 5) break;
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

      // 5. Search Store Locations (50+ Sucursales Kroser)
      if (
        lowerQ.includes('local') ||
        lowerQ.includes('sucursal') ||
        lowerQ.includes('horario') ||
        lowerQ.includes('direccion') ||
        lowerQ.includes('dirección') ||
        lowerQ.includes('donde') ||
        lowerQ.includes('dónde') ||
        lowerQ.includes('abierto') ||
        lowerQ.includes('telefono') ||
        lowerQ.includes('teléfono') ||
        lowerQ.includes('retiro') ||
        lowerQ.includes('retirar')
      ) {
        try {
          locales = await localesRepo.getAll();
        } catch (_e) {}
      }

      // 6. Search Shipping Zones & Delivery Costs
      if (
        lowerQ.includes('envio') ||
        lowerQ.includes('envío') ||
        lowerQ.includes('flete') ||
        lowerQ.includes('entrega') ||
        lowerQ.includes('delivery') ||
        lowerQ.includes('despacho') ||
        lowerQ.includes('domicilio') ||
        lowerQ.includes('costo') ||
        lowerQ.includes('montevideo') ||
        lowerQ.includes('interior') ||
        lowerQ.includes('zona')
      ) {
        try {
          const resZonas = await db.query('SELECT * FROM zonas_envio WHERE activo = true ORDER BY departamento_ciudad, barrio_zona');
          zonasEnvio = resZonas.rows || [];
        } catch (_e) {}
      }

      // 7. Search Payment Methods
      if (
        lowerQ.includes('pago') ||
        lowerQ.includes('pagar') ||
        lowerQ.includes('tarjeta') ||
        lowerQ.includes('mercadopago') ||
        lowerQ.includes('transferencia') ||
        lowerQ.includes('efectivo') ||
        lowerQ.includes('cuotas') ||
        lowerQ.includes('credito') ||
        lowerQ.includes('crédito') ||
        lowerQ.includes('debito') ||
        lowerQ.includes('débito') ||
        lowerQ.includes('oca') ||
        lowerQ.includes('visa') ||
        lowerQ.includes('master')
      ) {
        try {
          const resPagos = await db.query('SELECT * FROM formas_pago WHERE activo = true ORDER BY nombre');
          formasPago = resPagos.rows || [];
        } catch (_e) {}
      }
    } catch (err) {
      console.warn(`[RAG Search Warning] ${err.message}. Falling back to keyword search.`);
      try {
        productos = await productosRepo.searchByKeyword(queryText, 5);
      } catch (_e) {}
    }

    // 8. Format Prompt Context
    let contextStr = '';

    const formatCurrencyPrice = (p) => {
      const isUyu = (p.moneda || '').toUpperCase() === 'UYU' || (parseFloat(p.precio) >= 200 && (p.moneda || '').toUpperCase() !== 'USD');
      const symbol = isUyu ? '$' : 'U$S';
      const suffix = isUyu ? ' UYU' : '';
      if (p.precio_oferta) {
        return `${symbol} ${p.precio_oferta}${suffix} (Oferta, Normal: ${symbol} ${p.precio}${suffix})`;
      }
      return `${symbol} ${p.precio}${suffix}`;
    };

    if (productos.length > 0) {
      contextStr += 'PRODUCTOS RELEVANTES ENCONTRADOS EN CATÁLOGO:\n';
      productos.forEach((p) => {
        const precioText = formatCurrencyPrice(p);
        contextStr += `- SKU: ${p.sku} | ${p.nombre} | Marca: ${p.marca || 'N/A'} | Precio: ${precioText} | Stock: ${p.stock_status}\n`;
        if (p.producto_url) contextStr += `  Enlace web: ${p.producto_url}\n`;
        if (p.descripcion) contextStr += `  Descripción: ${p.descripcion.substring(0, 150)}...\n`;
      });
      contextStr += '\n';
    } else {
      contextStr += 'PRODUCTOS ENCONTRADOS EN CATÁLOGO: Ninguno con suficiente relevancia directa para la consulta.\n\n';
    }

    if (alternativas.length > 0) {
      contextStr += 'ALTERNATIVAS RECOMENDADAS CON STOCK (Para ofrecer si el producto principal está agotado o no disponible):\n';
      alternativas.forEach((p) => {
        const precioText = formatCurrencyPrice(p);
        contextStr += `- SKU: ${p.sku} | ${p.nombre} | Marca: ${p.marca || 'N/A'} | Precio: ${precioText} | Stock: ${p.stock_status}\n`;
        if (p.producto_url) contextStr += `  Enlace web: ${p.producto_url}\n`;
      });
      contextStr += '\n';
    }

    if (complementarios.length > 0) {
      contextStr += 'SUGERENCIAS DE VENTA CRUZADA (CROSS-SELLING - Para ofrecer amablemente como complemento):\n';
      complementarios.forEach((p) => {
        const precioText = formatCurrencyPrice(p);
        contextStr += `- SKU: ${p.sku} | ${p.nombre} | Precio: ${precioText}\n`;
        if (p.producto_url) contextStr += `  Enlace web: ${p.producto_url}\n`;
      });
      contextStr += '\n';
    }

    if (locales.length > 0) {
      contextStr += 'SUCURSALES Y LOCALES KROSER (Para retiro o visita):\n';
      locales.forEach((l) => {
        contextStr += `- ${l.nombre} (${l.zona}): ${l.direccion} | Tel: ${l.telefono} | Horario: ${l.horario}\n`;
      });
      contextStr += '\n';
    }

    if (zonasEnvio.length > 0) {
      contextStr += 'ZONAS Y COSTOS DE ENVÍO A DOMICILIO KROSER:\n';
      zonasEnvio.forEach((z) => {
        const costoText = parseFloat(z.costo_envio) === 0 ? 'ENVÍO GRATIS' : `$${z.costo_envio}`;
        contextStr += `- ${z.departamento_ciudad} (${z.barrio_zona}): Costo ${costoText}\n`;
      });
      contextStr += '\n';
    }

    if (formasPago.length > 0) {
      contextStr += 'FORMAS DE PAGO ACEPTADAS:\n';
      formasPago.forEach((f) => {
        contextStr += `- ${f.nombre}: ${f.descripcion || ''} ${f.instrucciones ? `| Detalle: ${f.instrucciones}` : ''}\n`;
      });
      contextStr += '\n';
    }

    return {
      contextStr,
      productosEncontrados: productos,
      alternativasEncontradas: alternativas,
      complementariosEncontrados: complementarios,
      localesEncontrados: locales,
      zonasEnvioEncontradas: zonasEnvio,
      formasPagoEncontradas: formasPago,
    };
  },
};

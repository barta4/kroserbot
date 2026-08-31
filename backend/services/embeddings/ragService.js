const db = require('../../config/db');
const embeddingProvider = require('./embeddingProvider');
const productosRepo = require('../../repositories/productosRepository');
const localesRepo = require('../../repositories/localesRepository');
const guiasTecnicasRepo = require('../../repositories/guiasTecnicasRepository');

const SIMILARITY_THRESHOLD = 0.35; // Calibrated cosine similarity threshold for pgvector

// Expanded Cross-Selling & Hardware Work Bundles Map
const CROSS_SELLING_MAP = {
  // Pintura & Revestimientos
  pintura: ['pincel', 'rodillo', 'cinta', 'lija', 'bandeja', 'aguarras', 'fijador', 'enduido', 'plastico'],
  latex: ['rodillo', 'pincel', 'cinta', 'bandeja', 'fijador', 'enduido', 'lija'],
  esmalte: ['pincel', 'aguarras', 'diluyente', 'lija', 'antioxido', 'cinta'],
  barniz: ['pincel', 'aguarras', 'lija fina', 'cinta'],
  cetol: ['pincel', 'aguarras', 'lija', 'cinta'],
  membrana: ['malla', 'venda', 'rodillo', 'sellador', 'fijador', 'pincel'],
  impermeabilizante: ['malla', 'venda', 'rodillo', 'sellador', 'fijador'],

  // Herramientas Eléctricas & EPP Obligatorio
  amoladora: ['disco corte', 'disco desbaste', 'disco flap', 'gafas', 'guante', 'protector auditivo'],
  taladro: ['mecha widia', 'mecha acero', 'broca', 'tarugo', 'gafas', 'prolongador'],
  atornillador: ['punta atornillar', 'set puntas', 'tornillo', 'tarugo', 'gafas'],
  sierra: ['hoja sierra', 'disco sierra', 'prensa', 'gafas', 'guante'],

  // Construcción en Seco (Yeso / Drywall)
  yeso: ['solera', 'montante', 'tornillo t1', 'tornillo t2', 'masilla', 'cinta junta', 'lija'],
  placa: ['solera', 'montante', 'tornillo t1', 'tornillo t2', 'masilla', 'cinta junta'],
  drywall: ['solera', 'montante', 'tornillo', 'masilla', 'cinta'],

  // Pisos & Revestimientos
  porcelanato: ['adhesivo', 'pegamento', 'pastina', 'cruceta', 'llana', 'nivelador'],
  ceramica: ['adhesivo', 'pastina', 'cruceta', 'llana', 'esponja'],
  adhesivo: ['llana', 'pastina', 'esponja', 'cruceta'],

  // Sanitaria & Plomería
  sanitaria: ['teflon', 'flexible', 'adhesivo pvc', 'llave francesa'],
  canilla: ['teflon', 'flexible', 'llave francesa', 'cartucho ceramico'],
  griferia: ['flexible', 'teflon', 'llave francesa', 'sellador silicona'],
  inodoro: ['flexible', 'fuelle', 'tornillo fijacion', 'sellador silicona'],
  mochila: ['flexible', 'flotante', 'obturador', 'teflon'],

  // Adhesivos & Selladores
  silicona: ['pistola silicona', 'pistola calafateo', 'cinta papel', 'espatula'],
  poliuretano: ['pistola silicona', 'guante', 'espatula'],
  sellador: ['pistola silicona', 'cinta papel', 'espatula'],

  // Metales & Maderas
  oxido: ['desoxidante', 'antioxido', 'convertidor', 'cepillo alambre', 'lija', 'pincel'],
  reja: ['cepillo alambre', 'esmalte 3 en 1', 'antioxido', 'pincel'],

  // Electricidad
  electricidad: ['cinta aisladora', 'buscapolo', 'cable', 'termica', 'disyuntor', 'pinza'],
  termica: ['cinta aisladora', 'buscapolo', 'cable', 'tablero'],

  // Fijaciones
  tarugo: ['tornillo', 'mecha widia', 'taladro', 'nivel'],
  tornillo: ['tarugo', 'punta atornillar', 'destornillador'],
};

module.exports = {
  async getRelevantContext(queryText) {
    let productos = [];
    let alternativas = [];
    let complementarios = [];
    let guiasTecnicas = [];
    let locales = [];
    let zonasEnvio = [];
    let formasPago = [];

    const lowerQ = (queryText || '').toLowerCase();

    // 1. Keyword & Vector Product Search
    try {
      const keywordResults = await productosRepo.searchByKeyword(queryText, 5);
      let vectorResults = [];
      try {
        const queryEmbedding = await embeddingProvider.generateSingleEmbedding(queryText);
        if (queryEmbedding && queryEmbedding.length > 0) {
          const rawVector = await productosRepo.searchVector(queryEmbedding, 5);
          vectorResults = rawVector.filter((p) => p.similarity !== undefined && p.similarity >= 0.52);
        }
      } catch (_vErr) {}

      const seenSkus = new Set();
      for (const item of [...keywordResults, ...vectorResults]) {
        if (!seenSkus.has(item.sku)) {
          seenSkus.add(item.sku);
          productos.push(item);
        }
        if (productos.length >= 5) break;
      }
    } catch (_pErr) {}

    // 2. Smart Substitution for Out-of-Stock Products
    try {
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
    } catch (_aErr) {}

    // 3. Cross-Selling / Complementary Work Kits Suggestion
    try {
      const searchTargets = [
        lowerQ,
        ...productos.map((p) => `${p.categoria || ''} ${p.nombre || ''}`.toLowerCase()),
      ].join(' ');

      const matchedComplementaryTerms = new Set();
      Object.keys(CROSS_SELLING_MAP).forEach((key) => {
        if (searchTargets.includes(key)) {
          CROSS_SELLING_MAP[key].forEach((term) => matchedComplementaryTerms.add(term));
        }
      });

      if (matchedComplementaryTerms.size > 0) {
        complementarios = await productosRepo.getComplementaryItems(Array.from(matchedComplementaryTerms), 3);
      }
    } catch (_cErr) {}

    // 4. Search Relevant Hardware Technical Guides & Calculations (guias_tecnicas)
    try {
      guiasTecnicas = await guiasTecnicasRepo.searchRelevant(queryText, 2);
    } catch (_gErr) {}

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
      contextStr += 'KITS Y COMPLEMENTOS INDISPENSABLES (Para ofrecer como complemento útil en 1 sola línea amigable):\n';
      complementarios.forEach((p) => {
        const precioText = formatCurrencyPrice(p);
        contextStr += `- SKU: ${p.sku} | ${p.nombre} | Precio: ${precioText}\n`;
        if (p.producto_url) contextStr += `  Enlace web: ${p.producto_url}\n`;
      });
      contextStr += '\n';
    }

    if (guiasTecnicas.length > 0) {
      contextStr += 'GUÍAS TÉCNICAS Y RECOMENDACIONES DE FERRETERÍA (Base de conocimiento para cálculo y diagnóstico):\n';
      guiasTecnicas.forEach((g) => {
        contextStr += `--- GUÍA: ${g.titulo.toUpperCase()} (${g.categoria}) ---\n${g.contenido}\n\n`;
      });
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
      guiasTecnicasEncontradas: guiasTecnicas,
      localesEncontrados: locales,
      zonasEnvioEncontradas: zonasEnvio,
      formasPagoEncontradas: formasPago,
    };
  },
};

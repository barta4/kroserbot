const db = require('../../config/db');
const productosRepo = require('../../repositories/productosRepository');
const localesRepo = require('../../repositories/localesRepository');
const guiasTecnicasRepo = require('../../repositories/guiasTecnicasRepository');
const pedidosRepo = require('../../repositories/pedidosRepository');
const configuracionRepo = require('../../repositories/configuracionRepository');
const orderTrackingService = require('../pedidos/orderTrackingService');
const emailService = require('../email/emailService');
const searchService = require('../search/searchService');
const { classifyQuery } = require('../search/queryClassifier');
const logger = require('../../config/logger');


const CROSS_SELLING_MAP = require('../../utils/crossSellingMap');
const { formatCurrencyPrice } = require('../../utils/formatCurrency');
const { normalize } = require('../../utils/textNormalizer');
const { extractEnrichedProductQuery } = require('../../utils/queryAnalyzer');
const pricingCalculator = require('../../utils/pricingCalculator');
const traductorTecnico = require('../../utils/traductorTecnico');

/**
 * Standard definitions of available tools (JSON Schema)
 */
const TOOL_DEFINITIONS = [
  {
    name: 'buscar_productos',
    description: 'Busca productos, precios y stock en catálogo Kroser. IMPORTANTE: En "consulta" incluya siempre marca, modelo y especificaciones exactas si el cliente las mencionó (ej: "hidrolavadora alpha-pro 1600w", "taladro percutor dewalt 13mm"). NUNCA reduzca la búsqueda a una categoría genérica si el cliente aportó detalles.',
    parameters: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Artículo, marca, modelo o especificación exacta a buscar' },
      },
      required: ['consulta'],
    },
  },
  {
    name: 'buscar_sucursales',
    description: 'Consulta locales Kroser, direcciones, teléfonos y horarios.',
    parameters: {
      type: 'object',
      properties: {
        zona: { type: 'string', description: 'Barrio, ciudad o departamento' },
      },
    },
  },
  {
    name: 'buscar_envio',
    description: 'Consulta costos y condiciones de envío a domicilio según zona.',
    parameters: {
      type: 'object',
      properties: {
        zona: { type: 'string', description: 'Barrio, ciudad o departamento' },
      },
    },
  },
  {
    name: 'formas_pago',
    description: 'Medios de pago aceptados (tarjetas, cuotas, MercadoPago, transferencias).',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'consultar_guia_tecnica',
    description: 'Guías técnicas de ferretería (rendimiento pintura m2, humedad, sanitaria).',
    parameters: {
      type: 'object',
      properties: {
        tema: { type: 'string', description: 'Tema técnico (ej: pintura, humedad)' },
      },
      required: ['tema'],
    },
  },
  {
    name: 'consultar_pedido',
    description: 'Consulta estado de preparación y despacho de una compra por número.',
    parameters: {
      type: 'object',
      properties: {
        referencia: { type: 'string', description: 'Número de pedido o compra' },
      },
      required: ['referencia'],
    },
  },
  {
    name: 'registrar_pedido',
    description: 'Registra un pedido formal confirmado con datos de contacto y entrega.',
    parameters: {
      type: 'object',
      properties: {
        cliente: {
          type: 'object',
          properties: {
            nombre: { type: 'string' },
            telefono: { type: 'string' },
            direccion: { type: 'string' },
            sucursal_retiro: { type: 'string' },
            forma_pago: { type: 'string' },
            notas: { type: 'string' },
          },
          required: ['nombre', 'telefono'],
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string' },
              nombre: { type: 'string' },
              cantidad: { type: 'number' },
              precio: { type: 'number' },
            },
            required: ['nombre', 'cantidad'],
          },
        },
      },
      required: ['cliente', 'items'],
    },
  },
];

/**
 * Returns declarations formatted for Gemini API
 */
function getGeminiTools({ enableOrders = true } = {}) {
  const filteredTools = enableOrders
    ? TOOL_DEFINITIONS
    : TOOL_DEFINITIONS.filter((t) => t.name !== 'registrar_pedido');

  return [
    {
      functionDeclarations: filteredTools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

/**
 * Returns tools formatted for OpenAI API
 */
function getOpenAITools({ enableOrders = true } = {}) {
  const filteredTools = enableOrders
    ? TOOL_DEFINITIONS
    : TOOL_DEFINITIONS.filter((t) => t.name !== 'registrar_pedido');

  return filteredTools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

const EMPTY_SEARCH_DIRECTIVE = 'NO se encontraron artículos coincidentes en catálogo. DIRECTIVA OBLIGATORIA (OPTIMIZADO WHATSAPP / META): Responda en UN SOLO MENSAJE informando que no tenemos en el catálogo y solicitando ubicación para indicar el local. PROHIBIDO ofrecer productos similares o alternativos. Fórmula exacta: "Hola, no tenemos en el catálogo. Si desea, páseme su ubicación y le envío los datos de nuestros locales."';

/**
 * Tool Executors
 */
async function executeBuscarProductos({ consulta = '' }, context = {}) {
  const rawQuery = (consulta || '').trim();
  const lastUserMsg = context?.lastUserMessage || '';
  const enrichedQuery = extractEnrichedProductQuery(rawQuery, lastUserMsg);

  // Agente clasificador (LLM): interpreta mensajes coloquiales / modismos uruguayos.
  // Devuelve null ante cualquier fallo -> se usa el clasificador por reglas.
  let classification = null;
  try {
    classification = await classifyQuery(lastUserMsg || rawQuery, { context: context?.recentContext });
  } catch (cErr) {
    logger.warn('executeBuscarProductos: classifier error', { error: cErr.message });
  }

  const effectiveQuery = ((classification && classification.queries[0]) || enrichedQuery || rawQuery || '').trim();

  if (!effectiveQuery) {
    return {
      productos: [],
      total_coincidencias: 0,
      directiva_vendedor: EMPTY_SEARCH_DIRECTIVE,
    };
  }

  // 1. ROL: El Traductor Técnico
  // Limpia el mensaje del cliente, remueve verbos de compra y traduce modismos vulgares a nombres oficiales de catálogo
  const fichaTecnicaMsg = lastUserMsg ? traductorTecnico.generarFichaTecnica(lastUserMsg) : null;
  const fichaTecnicaQuery = rawQuery ? traductorTecnico.generarFichaTecnica(rawQuery) : null;
  const fichaTecnica = (fichaTecnicaMsg && (fichaTecnicaMsg.fue_traducido || fichaTecnicaMsg.faltante))
    ? fichaTecnicaMsg
    : (fichaTecnicaQuery || { consulta_tecnica: effectiveQuery, especificaciones: {}, faltante: null, fue_traducido: false });

  let productos = [];
  let alternativas = [];
  let complementarios = [];
  const lowerQ = effectiveQuery.toLowerCase();

  // 2. ROL: El Encargado del Depósito
  // Recibe la palabra limpia técnica del catálogo (ej: "tijera corta tubo pvc") para buscar existencias exactas
  const targetSearch = (fichaTecnica.fue_traducido && fichaTecnica.consulta_tecnica)
    ? fichaTecnica.consulta_tecnica
    : effectiveQuery;

  // 1. Hybrid search (exact + textual + vector with re-ranking)
  try {
    const queries = [];
    const pushQuery = (q) => {
      const v = (q || '').trim();
      if (v && !queries.includes(v)) queries.push(v);
    };
    if (classification) classification.queries.forEach(pushQuery);
    // Prioridad al término técnico traducido (rol Traductor Técnico)
    pushQuery(targetSearch);
    pushQuery(enrichedQuery);
    pushQuery(rawQuery);

    if (classification && queries.length > 1) {
      // Multi-query: se ejecutan en paralelo y se fusionan por SKU respetando prioridad
      const resultsPerQuery = await Promise.all(
        queries.slice(0, 5).map((q) => searchService.hybridSearch(q, { limit: 5 }).catch(() => []))
      );
      const seen = new Set();
      for (const list of resultsPerQuery) {
        for (const p of list) {
          if (p.sku && !seen.has(p.sku)) {
            seen.add(p.sku);
            productos.push(p);
          }
        }
      }
      productos = productos.slice(0, 5);
      logger.info('executeBuscarProductos: classifier multi-query search', {
        original: lastUserMsg || rawQuery,
        queries,
        found: productos.length,
      });
    } else {
      const primaryQuery = targetSearch || effectiveQuery;
      productos = await searchService.hybridSearch(primaryQuery, { limit: 5 });
      // If the technical/enriched query yielded 0 results, fall back to the LLM's original rawQuery
      if (productos.length === 0 && rawQuery && rawQuery !== primaryQuery && rawQuery !== effectiveQuery) {
        logger.info('executeBuscarProductos: enriched query found 0, falling back to rawQuery', {
          primaryQuery,
          rawQuery,
        });
        productos = await searchService.hybridSearch(rawQuery, { limit: 5 });
      }
    }
  } catch (pErr) {
    logger.error('Error in hybrid search tool', { error: pErr.message });
  }

  // Si el cliente especificó una medida exacta (ej: 42 mm), priorizar esa variante en el depósito
  if (fichaTecnica.especificaciones?.milimetros && productos.length > 1) {
    const mmBuscado = String(fichaTecnica.especificaciones.milimetros);
    productos.sort((a, b) => {
      const matchA = (a.nombre || '').includes(mmBuscado) ? -1 : 0;
      const matchB = (b.nombre || '').includes(mmBuscado) ? -1 : 0;
      return matchA - matchB;
    });
  }

  // 2. Smart substitutions: ONLY if a specific searched item was found but is out of stock.
  // NEVER offer alternatives when 0 products match the search (as requested to avoid unwanted similar suggestions)
  try {
    const outOfStockItem = productos.find((p) => p.stock_status === 'out_of_stock');
    if (outOfStockItem) {
      const targetCategory = outOfStockItem.categoria || effectiveQuery;
      const targetBrand = outOfStockItem.marca || '';
      alternativas = await productosRepo.getAlternatives({
        categoria: targetCategory,
        marca: targetBrand,
        excludeSku: outOfStockItem.sku || '',
        limit: 3,
      });
    }
  } catch (aErr) {
    logger.warn('Error in getAlternatives tool', { error: aErr.message });
  }

  // 3. Cross-selling suggestions (only if productos were found)
  try {
    if (productos.length > 0) {
      const searchTargets = [lowerQ, ...productos.map((p) => `${p.categoria || ''} ${p.nombre || ''}`.toLowerCase())].join(' ');
      const matchedComplementaryTerms = new Set();
      Object.keys(CROSS_SELLING_MAP).forEach((key) => {
        if (searchTargets.includes(key)) {
          CROSS_SELLING_MAP[key].forEach((term) => matchedComplementaryTerms.add(term));
        }
      });

      if (matchedComplementaryTerms.size > 0) {
        complementarios = await productosRepo.getComplementaryItems(Array.from(matchedComplementaryTerms), 3);
      }
    }
  } catch (cErr) {
    logger.warn('Error in getComplementaryItems tool', { error: cErr.message });
  }

  let directivaVendedor = 'Mencione ÚNICAMENTE el producto principal con su precio en 1 o 2 oraciones breves de chat. NO arme listas con viñetas ni mencione varios artículos. Pregunte de forma cordial si le sirve esa opción.';

  if (productos.length === 0) {
    directivaVendedor = EMPTY_SEARCH_DIRECTIVE;
  } else if (productos.length > 1 && fichaTecnica.faltante) {
    // 3. ROL: El Vendedor del Mostrador (Variantes en depósito pero falta dato técnico clave)
    const variantesTexto = productos.slice(0, 3).map((p) => `${p.nombre} (${formatCurrencyPrice(p)})`).join(' y ');
    directivaVendedor = `El Encargado del Depósito confirmó stock de ${productos.length} opciones (${variantesTexto}). El Traductor Técnico indica que falta definir: ${fichaTecnica.faltante}. Como Vendedor del Mostrador, confirme amablemente que tenemos en stock, mencione las opciones disponibles con sus precios, y consulte de forma cálida el dato faltante para asesorar al cliente.`;
  }

  const client = context?.cliente;

  const res = {
    productos: productos.slice(0, 4).map((p) => {
      let precioTexto = formatCurrencyPrice(p);
      if (client) {
        const priced = pricingCalculator.calculateProductPrice(p, client);
        if (priced && priced.descuento_porcentaje > 0) {
          precioTexto = `${formatCurrencyPrice(p)} (Tu precio ${client.categoria || 'cliente'} con ${priced.descuento_porcentaje}% OFF: $ ${priced.precio_final})`;
        }
      }
      const item = {
        id: p.id,
        sku: p.sku,
        nombre: p.nombre,
        precio: precioTexto,
        precio_numerico: parseFloat(p.precio_oferta || p.precio) || 0,
        moneda: p.moneda || 'UYU',
        stock_status: p.stock_status,
      };
      if (p.marca && p.marca !== 'N/A') item.marca = p.marca;
      if (p.producto_url) item.enlace_web = p.producto_url;
      if (p.descripcion && p.descripcion.trim().length > 0) {
        item.detalles = p.descripcion.trim().substring(0, 60);
      }
      return item;
    }),
    producto_destacado: productos[0] ? {
      sku: productos[0].sku,
      nombre: productos[0].nombre,
      precio: formatCurrencyPrice(productos[0]),
      stock_status: productos[0].stock_status,
      marca: (productos[0].marca && productos[0].marca !== 'N/A') ? productos[0].marca : undefined,
    } : null,
    total_coincidencias: productos.length,
    directiva_vendedor: directivaVendedor,
  };

  // Ficha técnica del Traductor y Reporte del Depósito para enriquecer la decisión del Vendedor
  if (fichaTecnica.fue_traducido || fichaTecnica.faltante) {
    res.nota_traductor = {
      termino_cliente: lastUserMsg || rawQuery,
      termino_tecnico_catalogo: fichaTecnica.consulta_tecnica,
      dato_pendiente: fichaTecnica.faltante || null,
      especificaciones_detectadas: fichaTecnica.especificaciones || {},
    };
  }

  if (productos.length > 0) {
    res.reporte_deposito = {
      stock_confirmado: true,
      articulos_encontrados: productos.length,
      opciones: productos.slice(0, 3).map((p) => ({
        sku: p.sku,
        nombre: p.nombre,
        precio: formatCurrencyPrice(p),
        stock: p.stock_status,
      })),
    };
  }

  if (alternativas.length > 0) {
    res.alternativas = alternativas.slice(0, 2).map((p) => {
      const item = {
        sku: p.sku,
        nombre: p.nombre,
        precio: formatCurrencyPrice(p),
        stock_status: p.stock_status,
      };
      if (p.producto_url) item.enlace_web = p.producto_url;
      return item;
    });
  }

  if (complementarios.length > 0) {
    res.complementarios_sugeridos = complementarios.slice(0, 2).map((p) => {
      const item = {
        sku: p.sku,
        nombre: p.nombre,
        precio: formatCurrencyPrice(p),
      };
      if (p.producto_url) item.enlace_web = p.producto_url;
      return item;
    });
    res.nota_cross_selling = 'No mencione consumibles de entrada; solo consúltelos si el cliente demuestra intención de compra.';
  }

  return res;
}

async function executeBuscarSucursales({ zona = '' } = {}) {
  try {
    let locales = [];
    if (zona && zona.trim()) {
      locales = await localesRepo.search(zona.trim());
    }
    if (!locales || locales.length === 0) {
      locales = await localesRepo.getAll();
    }
    const safeLocales = (locales || []).slice(0, 15);
    return {
      sucursales: safeLocales.map((l) => ({
        nombre: l.nombre,
        zona: l.zona,
        direccion: l.direccion,
        telefono: l.telefono,
        horario: l.horario,
      })),
      total_encontradas: (locales || []).length,
    };
  } catch (err) {
    logger.error('Error in executeBuscarSucursales', { error: err.message });
    return { sucursales: [], error: 'No se pudieron consultar los locales' };
  }
}

async function executeBuscarEnvio({ zona = '' } = {}) {
  try {
    const res = await db.query('SELECT * FROM zonas_envio WHERE activo = true ORDER BY departamento_ciudad, barrio_zona');
    let rows = res.rows || [];
    if (zona && zona.trim()) {
      const q = normalize(zona);
      const filtered = rows.filter(
        (z) => normalize(z.departamento_ciudad || '').includes(q) || normalize(z.barrio_zona || '').includes(q)
      );
      if (filtered.length > 0) rows = filtered;
    }
    const safeRows = rows.slice(0, 15);
    return {
      zonas_envio: safeRows.map((z) => ({
        departamento_ciudad: z.departamento_ciudad,
        barrio_zona: z.barrio_zona,
        costo_envio: parseFloat(z.costo_envio) === 0 ? 'ENVÍO GRATIS' : `$ ${z.costo_envio} UYU`,
      })),
      total_encontradas: rows.length,
    };
  } catch (err) {
    logger.error('Error in executeBuscarEnvio', { error: err.message });
    return { zonas_envio: [], error: 'No se pudieron consultar las zonas de envío' };
  }
}

async function executeFormasPago() {
  try {
    const res = await db.query('SELECT * FROM formas_pago WHERE activo = true ORDER BY nombre');
    return {
      formas_pago: (res.rows || []).map((f) => ({
        nombre: f.nombre,
        descripcion: f.descripcion || '',
        instrucciones: f.instrucciones || '',
      })),
    };
  } catch (err) {
    logger.error('Error in executeFormasPago', { error: err.message });
    return { formas_pago: [], error: 'No se pudieron consultar las formas de pago' };
  }
}

async function executeConsultarGuiaTecnica({ tema = '' }) {
  try {
    const guias = await guiasTecnicasRepo.searchRelevant(tema, 2);
    return {
      guias_tecnicas: (guias || []).map((g) => ({
        titulo: g.titulo,
        categoria: g.categoria,
        resumen: g.resumen,
        contenido: g.contenido,
      })),
    };
  } catch (err) {
    logger.error('Error in executeConsultarGuiaTecnica', { error: err.message });
    return { guias_tecnicas: [], error: 'No se pudieron consultar las guías técnicas' };
  }
}

async function executeConsultarPedido({ referencia = '' }) {
  try {
    const trackingResult = await orderTrackingService.getTrackingInfo({ text: referencia });
    if (trackingResult.hasOrder) {
      return {
        encontrado: true,
        pedido_ref: trackingResult.orderRef,
        estado: trackingResult.status,
        detalle: trackingResult.contextStr,
      };
    }
    return {
      encontrado: false,
      mensaje: `No se encontró ningún pedido con la referencia "${referencia}".`,
    };
  } catch (err) {
    logger.error('Error in executeConsultarPedido', { error: err.message });
    return { encontrado: false, error: 'No se pudo consultar el pedido' };
  }
}

async function executeRegistrarPedido({ cliente = {}, items = [] }, context = {}) {
  const pedidosConfig = await configuracionRepo.get('pedidos_enabled');
  if (pedidosConfig === 'false') {
    logger.warn('Attempt to register order while orders are disabled');
    return {
      status: 'disabled',
      mensaje: 'La toma y registro de pedidos por este canal de chat está temporalmente deshabilitada en el sistema. Por favor indique al cliente que puede realizar su compra a través del sitio web oficial https://kroser.com.uy o acercándose a nuestros locales de Av. 8 de Octubre 3452 / 3451.',
      createdOrder: null,
    };
  }

  // Strict Validation to prevent premature/incomplete order creation
  const nombre = (cliente.nombre || '').trim();
  const telefono = (cliente.telefono || '').trim();
  const direccion = (cliente.direccion || cliente.sucursal_retiro || '').trim();

  const missingFields = [];
  if (!nombre || nombre.toLowerCase().includes('cliente kroser')) missingFields.push('nombre completo');
  if (!telefono) missingFields.push('teléfono de contacto');
  if (!direccion) missingFields.push('dirección de entrega o sucursal de retiro');

  if (missingFields.length > 0) {
    return {
      status: 'error',
      mensaje: `No se pudo registrar el pedido. Faltan datos obligatorios del cliente: ${missingFields.join(', ')}. Por favor solicite estos datos al cliente antes de registrar el pedido.`,
    };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return {
      status: 'error',
      mensaje: 'No se especificaron artículos para el pedido. Confirme con el cliente qué artículos y cantidades desea.',
    };
  }

  try {
    const client = context?.cliente;
    const normalizedItems = [];
    for (const it of items) {
      const rawCant = parseInt(it.cantidad, 10);
      const cant = (isNaN(rawCant) || rawCant < 1) ? 1 : Math.min(999, rawCant);

      let finalUnitPrecio = 0;
      let finalSku = String(it.sku || 'SKU-TEMP').trim().slice(0, 50);
      let finalNombre = String(it.nombre || 'Artículo').trim().slice(0, 150);

      // Si el producto existe en el catálogo, tomar el precio oficial y evitar manipulación por LLM prompt injection
      let catalogProd = null;
      try {
        if (it.sku && typeof productosRepo.findBySku === 'function') {
          catalogProd = await productosRepo.findBySku(it.sku);
        }
        if (!catalogProd && it.id && typeof productosRepo.findByIdWithPromocion === 'function') {
          catalogProd = await productosRepo.findByIdWithPromocion(it.id);
        }
      } catch (_catErr) {
        catalogProd = null;
      }

      if (catalogProd) {
        finalSku = catalogProd.sku || finalSku;
        finalNombre = catalogProd.nombre || finalNombre;
        const priced = pricingCalculator.calculateProductPrice(catalogProd, client);
        finalUnitPrecio = priced?.precio_final || parseFloat(catalogProd.precio_oferta || catalogProd.precio) || 0;
      } else {
        const itemPrice = parseFloat(it.precio);
        finalUnitPrecio = (!isNaN(itemPrice) && itemPrice >= 0 && itemPrice < 1000000) ? itemPrice : 0;
      }

      normalizedItems.push({
        sku: finalSku,
        nombre: finalNombre,
        cantidad: cant,
        precio: Math.round(finalUnitPrecio * 100) / 100,
        subtotal: Math.round(cant * finalUnitPrecio * 100) / 100,
      });
    }

    const normalizedCliente = {
      nombre,
      telefono,
      direccion: cliente.direccion || cliente.sucursal_retiro || 'A coordinar',
      email: cliente.email || '',
      sucursal_retiro: cliente.sucursal_retiro || '',
      forma_pago: cliente.forma_pago || 'A coordinar',
      notas: cliente.notas || '',
    };

    const createdOrder = await pedidosRepo.create({
      conversation_id: context.conversationId || `sim_${Date.now()}`,
      account_id: context.accountId || 1,
      cliente: normalizedCliente,
      items: normalizedItems,
      origen: context.channel === 'Web Simulator' || context.channel === 'webwidget' ? 'simulador' : 'bot',
      pago_estado: 'sin_pago',
      estado_inicial: 'pendiente',
    });

    logger.info('Order registered via Tool Calling', {
      pedidoId: createdOrder.id,
      cliente: normalizedCliente.nombre,
      itemsCount: normalizedItems.length,
    });

    // Send email alert asynchronously
    try {
      await emailService.sendNewOrderAlert(createdOrder);
    } catch (eErr) {
      logger.warn('Order alert email dispatch failed in tool', { error: eErr.message });
    }

    return {
      status: 'ok',
      pedido_id: createdOrder.id,
      referencia: `#${createdOrder.id}`,
      mensaje: `Pedido #${createdOrder.id} registrado exitosamente a nombre de ${normalizedCliente.nombre}.`,
      createdOrder,
    };
  } catch (err) {
    logger.error('Error in executeRegistrarPedido', { error: err.message });
    return { status: 'error', mensaje: `Ocurrió un error al persistir el pedido: ${err.message}` };
  }
}

/**
 * Main dispatcher: executes tool by name with arguments and context
 */
async function executeTool(name, args = {}, context = {}) {
  logger.info('Executing tool', { toolName: name, args });
  switch (name) {
    case 'buscar_productos':
      return await executeBuscarProductos(args, context);
    case 'buscar_sucursales':
      return await executeBuscarSucursales(args);
    case 'buscar_envio':
      return await executeBuscarEnvio(args);
    case 'formas_pago':
      return await executeFormasPago(args);
    case 'consultar_guia_tecnica':
      return await executeConsultarGuiaTecnica(args);
    case 'consultar_pedido':
      return await executeConsultarPedido(args);
    case 'registrar_pedido':
      return await executeRegistrarPedido(args, context);
    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  getGeminiTools,
  getOpenAITools,
  executeTool,
};

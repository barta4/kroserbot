const db = require('../../config/db');
const productosRepo = require('../../repositories/productosRepository');
const localesRepo = require('../../repositories/localesRepository');
const guiasTecnicasRepo = require('../../repositories/guiasTecnicasRepository');
const pedidosRepo = require('../../repositories/pedidosRepository');
const orderTrackingService = require('../pedidos/orderTrackingService');
const emailService = require('../email/emailService');
const logger = require('../../config/logger');

let embeddingProvider = null;
try {
  embeddingProvider = require('../embeddings/embeddingProvider');
} catch (_e) {
  embeddingProvider = null;
}

const SIMILARITY_THRESHOLD = 0.52;

// Expanded Cross-Selling & Hardware Work Bundles Map
const CROSS_SELLING_MAP = {
  pintura: ['pincel', 'rodillo', 'cinta', 'lija', 'bandeja', 'aguarras', 'fijador', 'enduido'],
  latex: ['rodillo', 'pincel', 'cinta', 'bandeja', 'fijador', 'enduido', 'lija'],
  esmalte: ['pincel', 'aguarras', 'diluyente', 'lija', 'antioxido', 'cinta'],
  barniz: ['pincel', 'aguarras', 'lija fina', 'cinta'],
  cetol: ['pincel', 'aguarras', 'lija', 'cinta'],
  membrana: ['malla', 'venda', 'rodillo', 'sellador', 'fijador', 'pincel'],
  impermeabilizante: ['malla', 'venda', 'rodillo', 'sellador', 'fijador'],
  amoladora: ['disco corte', 'disco desbaste', 'disco flap', 'gafas', 'guante', 'protector auditivo'],
  taladro: ['mecha widia', 'mecha acero', 'broca', 'tarugo', 'gafas', 'prolongador'],
  atornillador: ['punta atornillar', 'set puntas', 'tornillo', 'tarugo', 'gafas'],
  sierra: ['hoja sierra', 'disco sierra', 'prensa', 'gafas', 'guante'],
  yeso: ['solera', 'montante', 'tornillo t1', 'tornillo t2', 'masilla', 'cinta junta', 'lija'],
  placa: ['solera', 'montante', 'tornillo t1', 'tornillo t2', 'masilla', 'cinta junta'],
  drywall: ['solera', 'montante', 'tornillo', 'masilla', 'cinta'],
  porcelanato: ['adhesivo', 'pegamento', 'pastina', 'cruceta', 'llana', 'nivelador'],
  ceramica: ['adhesivo', 'pastina', 'cruceta', 'llana', 'esponja'],
  adhesivo: ['llana', 'pastina', 'esponja', 'cruceta'],
  sanitaria: ['teflon', 'flexible', 'adhesivo pvc', 'llave francesa'],
  canilla: ['teflon', 'flexible', 'llave francesa', 'cartucho ceramico'],
  griferia: ['flexible', 'teflon', 'llave francesa', 'sellador silicona'],
  inodoro: ['flexible', 'fuelle', 'tornillo fijacion', 'sellador silicona'],
  mochila: ['flexible', 'flotante', 'obturador', 'teflon'],
  silicona: ['pistola silicona', 'pistola calafateo', 'cinta papel', 'espatula'],
  poliuretano: ['pistola silicona', 'guante', 'espatula'],
  sellador: ['pistola silicona', 'cinta papel', 'espatula'],
  oxido: ['desoxidante', 'antioxido', 'convertidor', 'cepillo alambre', 'lija', 'pincel'],
  reja: ['cepillo alambre', 'esmalte 3 en 1', 'antioxido', 'pincel'],
  electricidad: ['cinta aisladora', 'buscapolo', 'cable', 'termica', 'disyuntor', 'pinza'],
  termica: ['cinta aisladora', 'buscapolo', 'cable', 'tablero'],
  tarugo: ['tornillo', 'mecha widia', 'taladro', 'nivel'],
  tornillo: ['tarugo', 'punta atornillar', 'destornillador'],
};

function formatCurrencyPrice(p) {
  const isUyu = (p.moneda || '').toUpperCase() === 'UYU' || (parseFloat(p.precio) >= 200 && (p.moneda || '').toUpperCase() !== 'USD');
  const symbol = isUyu ? '$' : 'U$S';
  const suffix = isUyu ? ' UYU' : '';
  if (p.precio_oferta) {
    return `${symbol} ${p.precio_oferta}${suffix} (Oferta, Normal: ${symbol} ${p.precio}${suffix})`;
  }
  return `${symbol} ${p.precio}${suffix}`;
}

/**
 * Standard definitions of available tools (JSON Schema)
 */
const TOOL_DEFINITIONS = [
  {
    name: 'buscar_productos',
    description: 'Busca productos, repuestos, precios y stock en el catálogo oficial de Kroser. Incluye automáticamente sugerencias de consumibles y alternativas si no hay stock.',
    parameters: {
      type: 'object',
      properties: {
        consulta: {
          type: 'string',
          description: 'Nombre, marca, modelo o tipo de artículo a buscar (ej: "taladro percutor", "esmalte sintético 1L", "cartucho canilla")',
        },
      },
      required: ['consulta'],
    },
  },
  {
    name: 'buscar_sucursales',
    description: 'Consulta información de sucursales Kroser (dirección, teléfonos, horarios de atención y zonas de retiro).',
    parameters: {
      type: 'object',
      properties: {
        zona: {
          type: 'string',
          description: 'Departamento, ciudad o barrio de interés (opcional, ej: "Montevideo", "Paso Molino", "Canelones", "Punta del Este")',
        },
      },
    },
  },
  {
    name: 'buscar_envio',
    description: 'Consulta costos y condiciones de envío a domicilio según departamento, ciudad o barrio.',
    parameters: {
      type: 'object',
      properties: {
        zona: {
          type: 'string',
          description: 'Departamento, ciudad o barrio de entrega (opcional, ej: "Montevideo", "Las Piedras", "Maldonado")',
        },
      },
    },
  },
  {
    name: 'formas_pago',
    description: 'Consulta los medios de pago aceptados por Kroser (tarjetas, efectivo, MercadoPago, cuotas y transferencias).',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'consultar_guia_tecnica',
    description: 'Consulta guías técnicas y fórmulas de ferretería (cálculo de rendimiento de pintura por m2, diagnóstico de humedades, problemas de sanitaria, etc.).',
    parameters: {
      type: 'object',
      properties: {
        tema: {
          type: 'string',
          description: 'Tema o problema técnico a consultar (ej: "pintura", "humedad", "sanitaria", "drywall")',
        },
      },
      required: ['tema'],
    },
  },
  {
    name: 'consultar_pedido',
    description: 'Consulta el estado actual de preparación, despacho o entrega de un pedido existente.',
    parameters: {
      type: 'object',
      properties: {
        referencia: {
          type: 'string',
          description: 'Número de pedido o código de compra (ej: "#1042", "1042", "KRO-1042")',
        },
      },
      required: ['referencia'],
    },
  },
  {
    name: 'registrar_pedido',
    description: 'Registra un pedido formal en el sistema de Kroser. ÚNICAMENTE debe invocarse cuando el cliente haya confirmado explícitamente la compra y haya proporcionado nombre, teléfono y dirección o sucursal de retiro.',
    parameters: {
      type: 'object',
      properties: {
        cliente: {
          type: 'object',
          description: 'Datos de contacto del cliente',
          properties: {
            nombre: { type: 'string', description: 'Nombre completo del cliente' },
            telefono: { type: 'string', description: 'Teléfono o celular de contacto' },
            direccion: { type: 'string', description: 'Dirección completa de entrega a domicilio (si es con envío)' },
            sucursal_retiro: { type: 'string', description: 'Sucursal de retiro (si el cliente retira en local)' },
            forma_pago: { type: 'string', description: 'Forma de pago elegida (opcional)' },
            notas: { type: 'string', description: 'Notas adicionales para el despacho' },
          },
          required: ['nombre', 'telefono'],
        },
        items: {
          type: 'array',
          description: 'Lista de productos a comprar',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string', description: 'SKU del producto (si está disponible)' },
              nombre: { type: 'string', description: 'Nombre del producto' },
              cantidad: { type: 'number', description: 'Cantidad solicitada' },
              precio: { type: 'number', description: 'Precio unitario' },
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
function getGeminiTools() {
  return [
    {
      functionDeclarations: TOOL_DEFINITIONS.map((t) => ({
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
function getOpenAITools() {
  return TOOL_DEFINITIONS.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Tool Executors
 */
async function executeBuscarProductos({ consulta = '' }) {
  const query = (consulta || '').trim();
  if (!query) return { productos: [], alternativas: [], complementarios_sugeridos: [] };

  let productos = [];
  let alternativas = [];
  let complementarios = [];
  const lowerQ = query.toLowerCase();

  // 1. Keyword search
  try {
    const keywordResults = await productosRepo.searchByKeyword(query, 5);
    let vectorResults = [];
    if (embeddingProvider) {
      try {
        const queryEmbedding = await embeddingProvider.generateSingleEmbedding(query);
        if (queryEmbedding && queryEmbedding.length > 0) {
          const rawVector = await productosRepo.searchVector(queryEmbedding, 5);
          vectorResults = rawVector.filter((p) => p.similarity !== undefined && p.similarity >= SIMILARITY_THRESHOLD);
        }
      } catch (_vErr) {
        logger.warn('Vector search error in tool executor', { error: _vErr.message });
      }
    }

    const seenSkus = new Set();
    for (const item of [...keywordResults, ...vectorResults]) {
      if (!seenSkus.has(item.sku)) {
        seenSkus.add(item.sku);
        productos.push(item);
      }
      if (productos.length >= 5) break;
    }
  } catch (pErr) {
    logger.error('Error in searchByKeyword tool', { error: pErr.message });
  }

  // 2. Smart substitutions if out of stock
  try {
    const outOfStockItem = productos.find((p) => p.stock_status === 'out_of_stock');
    if (outOfStockItem || productos.length === 0) {
      const targetCategory = outOfStockItem ? outOfStockItem.categoria : query;
      const targetBrand = outOfStockItem ? outOfStockItem.marca : '';
      alternativas = await productosRepo.getAlternatives({
        categoria: targetCategory,
        marca: targetBrand,
        excludeSku: outOfStockItem ? outOfStockItem.sku : '',
        limit: 3,
      });
    }
  } catch (aErr) {
    logger.warn('Error in getAlternatives tool', { error: aErr.message });
  }

  // 3. Cross-selling suggestions
  try {
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
  } catch (cErr) {
    logger.warn('Error in getComplementaryItems tool', { error: cErr.message });
  }

  return {
    productos: productos.map((p) => ({
      sku: p.sku,
      nombre: p.nombre,
      marca: p.marca || 'N/A',
      precio: formatCurrencyPrice(p),
      stock_status: p.stock_status,
      enlace_web: p.producto_url || null,
      descripcion_corta: (p.descripcion || '').substring(0, 120),
    })),
    alternativas: alternativas.map((p) => ({
      sku: p.sku,
      nombre: p.nombre,
      marca: p.marca || 'N/A',
      precio: formatCurrencyPrice(p),
      stock_status: p.stock_status,
      enlace_web: p.producto_url || null,
    })),
    complementarios_sugeridos: complementarios.map((p) => ({
      sku: p.sku,
      nombre: p.nombre,
      precio: formatCurrencyPrice(p),
      enlace_web: p.producto_url || null,
    })),
  };
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
    return {
      sucursales: (locales || []).map((l) => ({
        nombre: l.nombre,
        zona: l.zona,
        direccion: l.direccion,
        telefono: l.telefono,
        horario: l.horario,
      })),
    };
  } catch (err) {
    logger.error('Error in executeBuscarSucursales', { error: err.message });
    return { sucursales: [], error: 'No se pudieron consultar las sucursales' };
  }
}

async function executeBuscarEnvio({ zona = '' } = {}) {
  try {
    const res = await db.query('SELECT * FROM zonas_envio WHERE activo = true ORDER BY departamento_ciudad, barrio_zona');
    let rows = res.rows || [];
    if (zona && zona.trim()) {
      const q = zona.trim().toLowerCase();
      const filtered = rows.filter(
        (z) => (z.departamento_ciudad || '').toLowerCase().includes(q) || (z.barrio_zona || '').toLowerCase().includes(q)
      );
      if (filtered.length > 0) rows = filtered;
    }
    return {
      zonas_envio: rows.map((z) => ({
        departamento_ciudad: z.departamento_ciudad,
        barrio_zona: z.barrio_zona,
        costo_envio: parseFloat(z.costo_envio) === 0 ? 'ENVÍO GRATIS' : `$ ${z.costo_envio} UYU`,
      })),
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
    const normalizedItems = items.map((it) => ({
      sku: String(it.sku || 'SKU-TEMP'),
      nombre: String(it.nombre || 'Artículo'),
      cantidad: parseInt(it.cantidad, 10) || 1,
      precio: parseFloat(it.precio) || 0,
      subtotal: (parseInt(it.cantidad, 10) || 1) * (parseFloat(it.precio) || 0),
    }));

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
      return await executeBuscarProductos(args);
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

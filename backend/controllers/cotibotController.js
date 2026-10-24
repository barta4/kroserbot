const crypto = require('crypto');
const promptBuilder = require('../services/webhook/promptBuilder');
const intentDetector = require('../services/webhook/intentDetector');
const llmService = require('../services/llm/llmService');
const configuracionRepo = require('../repositories/configuracionRepository');
const logger = require('../config/logger');
const pricingCalculator = require('../utils/pricingCalculator');
const orderExtractor = require('../services/pedidos/orderExtractor');
const searchService = require('../services/search/searchService');
const mediaService = require('../services/media/mediaService');
const conversacionesRepo = require('../repositories/conversacionesRepository');
const pedidosRepo = require('../repositories/pedidosRepository');
const productosRepo = require('../repositories/productosRepository');
const clientesRepo = require('../repositories/clientesRepository');
const emailService = require('../services/email/emailService');
const { formatCurrencyPrice } = require('../utils/formatCurrency');
const channelPolicyService = require('../services/channel/channelPolicy');
const guardrailService = require('../services/guardrails/guardrailService');

function parseMaterialList(text) {
  if (!text || typeof text !== 'string') return [];
  const trimmed = text.trim();

  let rawLines = [];
  if (trimmed.includes('\n')) {
    rawLines = trimmed.split(/\r?\n/);
  } else if (trimmed.includes(';') || (trimmed.includes(',') && trimmed.split(',').length >= 2)) {
    rawLines = trimmed.split(/[,;]/);
  } else {
    const numMatches = trimmed.split(/(?:^|\s)(?:\d+[.)-]|\*|-)\s+/);
    if (numMatches.length > 2) {
      rawLines = numMatches;
    }
  }

  if (rawLines.length < 2) return [];

  const ignoreWords = /^(hola|buenas|buenos dias|buenas tardes|cotizame|cotizar|necesito|quiero|lista|presupuesto|por favor|articulos|materiales|items):?$/i;

  const items = [];
  for (let raw of rawLines) {
    let clean = raw.trim().replace(/^[-*•]\s*/, '').replace(/^\d+[.)-]\s*/, '').trim();
    if (!clean || clean.length < 2) continue;
    if (ignoreWords.test(clean)) continue;

    let cantidad = 1;
    let query = clean;

    const qtyMatch = clean.match(/^(\d+)\s*(?:x|unidades?|unids?|un|bolsas?|lts?|litros?|latas?|cajas?|metros?|mts?|m|rollos?|kilos?|kg)?\s+(?:de\s+)?(.+)$/i);
    if (qtyMatch) {
      cantidad = parseInt(qtyMatch[1], 10) || 1;
      query = qtyMatch[2].trim();
    }

    if (query.length >= 2) {
      items.push({
        original: clean,
        query,
        cantidad,
      });
    }
  }

  return items.length >= 2 ? items : [];
}

module.exports = {
  async chat(req, res, next) {
    const startTime = Date.now();
    try {
      const {
        message = '',
        history = [],
        customerName: customName,
        attachments = [],
        image = null,
        audio = null,
        mimeType = null,
        conversationId: reqConversationId,
      } = req.body;

      const client = req.cliente || (req.user && req.user.role === 'cliente' ? req.user : null);
      let conversationId = (typeof reqConversationId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(reqConversationId.trim()))
        ? reqConversationId.trim()
        : null;
      if (!conversationId) {
        const randomHex = crypto.randomBytes(4).toString('hex');
        conversationId = `coti_web_${client ? client.id : 'anon'}_${Date.now()}_${randomHex}`;
      }

      // Normalize attachments from body (supports Chatwoot schema or direct image/audio payload)
      const rawAttachments = Array.isArray(attachments) ? [...attachments].slice(0, 5) : [];
      if (image && typeof image === 'string') {
        rawAttachments.push({
          file_type: 'image',
          data_url: image,
          content_type: mimeType || 'image/jpeg',
        });
      }
      if (audio && typeof audio === 'string') {
        rawAttachments.push({
          file_type: 'audio',
          data_url: audio,
          content_type: mimeType || 'audio/webm',
        });
      }

      // Security: filter attachments to disallow arbitrary external HTTP URLs from public web clients
      const safeAttachments = rawAttachments.filter((att) => {
        if (!att || typeof att !== 'object') return false;
        const target = att.data_url || att.url;
        if (!target || typeof target !== 'string') return false;
        if (target.startsWith('data:image/') || target.startsWith('data:audio/')) {
          return target.length <= 20 * 1024 * 1024;
        }
        if (target.startsWith('/')) return true; // Relative ActiveStorage path
        try {
          const u = new URL(target);
          const h = u.hostname.toLowerCase();
          return (h === 'uruchat.com' || h.endsWith('.uruchat.com') || h === 'kroser.uy' || h.endsWith('.kroser.uy'));
        } catch {
          return false;
        }
      });

      // Process multimodal attachments via mediaService (unified with WhatsApp/Chatwoot pipeline)
      let mediaResult = { mediaSummaries: [], transcribedTexts: [], visualSearchTerms: [], identifiedParts: [] };
      if (safeAttachments.length > 0) {
        try {
          logger.info('[CotibotController] Processing multimodal attachments', { count: safeAttachments.length });
          mediaResult = await mediaService.processMessageAttachments(safeAttachments);
        } catch (mediaErr) {
          logger.warn('[CotibotController] Error processing attachments', { error: mediaErr.message });
        }
      }

      let combinedText = typeof message === 'string' ? message.trim() : '';

      // Merge transcribed audio if available
      if (mediaResult.transcribedTexts.length > 0) {
        const audioTranscript = mediaResult.transcribedTexts.join(' ').trim();
        if (audioTranscript) {
          combinedText = combinedText ? `${combinedText}\n${audioTranscript}` : audioTranscript;
        }
      }

      // Merge visual parts summaries if available
      const nonAudioSummaries = mediaResult.mediaSummaries.filter((s) => !s.startsWith('[Audio transcripto:'));
      if (nonAudioSummaries.length > 0) {
        combinedText = combinedText ? `${combinedText}\n${nonAudioSummaries.join('\n')}` : nonAudioSummaries.join('\n');
      } else if (!combinedText && mediaResult.identifiedParts.length > 0) {
        combinedText = `Consulta sobre repuesto o pieza identificada: ${mediaResult.identifiedParts.join(', ')}`;
      } else if (!combinedText && mediaResult.visualSearchTerms.length > 0) {
        combinedText = `Busco repuesto de ferretería: ${mediaResult.visualSearchTerms.join(' ')}`;
      }

      if (!combinedText || combinedText.trim() === '') {
        return res.status(400).json({ error: 'El mensaje, audio o imagen no contiene una consulta válida' });
      }

      const trimmedMessage = combinedText.trim();

      // Log user incoming message asynchronously for session persistence
      conversacionesRepo.logMessage(conversationId, trimmedMessage, 'user').catch(() => {});

      const clientName = client ? client.nombre : (customName || 'Cliente');
      const discountPct = pricingCalculator.getEffectiveDiscount(client);
      const categoryName = client ? (client.categoria || 'minorista') : 'visitante';

      // 0. AGENT MULTI-ITEM MATERIAL LIST PROCESSOR
      const materialItems = parseMaterialList(trimmedMessage);
      if (materialItems.length >= 2) {
        logger.info('[CotibotController] Processing material list quotation', {
          itemCount: materialItems.length,
          client: clientName,
        });

        const matchedProducts = [];
        for (const item of materialItems) {
          try {
            const candidates = await searchService.hybridSearch(item.query, { limit: 1 });
            if (candidates && candidates.length > 0) {
              const prod = candidates[0];
              const priced = pricingCalculator.calculateProductPrice(prod, client);
              const unitPrice = priced.precio_final || parseFloat(prod.precio) || 0;
              const listPrice = parseFloat(prod.precio) || unitPrice;
              const unitSavings = Math.max(0, listPrice - unitPrice);
              const subtotal = Math.round(unitPrice * item.cantidad * 100) / 100;
              const ahorroTotal = Math.round(unitSavings * item.cantidad * 100) / 100;

              matchedProducts.push({
                solicitado: item.original,
                cantidad: item.cantidad,
                encontrado: true,
                id: prod.id,
                sku: prod.sku,
                nombre: prod.nombre,
                precio_unitario: unitPrice,
                precio_lista: listPrice,
                precio_final: unitPrice,
                ahorro_monto: unitSavings,
                ahorro_total: ahorroTotal,
                subtotal: subtotal,
                precio_texto: formatCurrencyPrice(prod),
                moneda: prod.moneda || 'UYU',
                stock_status: prod.stock_status,
                marca: prod.marca,
                enlace_web: prod.producto_url,
              });
            } else {
              matchedProducts.push({
                solicitado: item.original,
                cantidad: item.cantidad,
                encontrado: false,
                nombre: item.original,
                precio_unitario: 0,
                subtotal: 0,
                precio_texto: '$ A consultar',
              });
            }
          } catch (itemErr) {
            logger.warn('[CotibotController] Error searching item in list', { item: item.query, error: itemErr.message });
            matchedProducts.push({
              solicitado: item.original,
              cantidad: item.cantidad,
              encontrado: false,
              nombre: item.original,
              precio_unitario: 0,
              subtotal: 0,
              precio_texto: '$ A consultar',
            });
          }
        }

        const totalEstimado = matchedProducts.reduce((sum, it) => sum + (it.encontrado ? it.subtotal : 0), 0);
        const totalAhorro = matchedProducts.reduce((sum, it) => sum + (it.encontrado ? it.ahorro_total : 0), 0);
        const totalEncontrados = matchedProducts.filter((it) => it.encontrado).length;

        let replyText = `📋 **Presupuesto de Materiales — Kroser Martínez:**\n\n`;
        replyText += `Desglose de los **${materialItems.length} artículos** consultados en el catálogo oficial Kroser Martínez. Coincidencias encontradas:\n\n`;

        matchedProducts.forEach((it) => {
          if (it.encontrado) {
            replyText += `• **${it.cantidad}x ${it.nombre}** — $ ${it.subtotal} ${it.moneda} *(Unit: $ ${it.precio_unitario})*\n`;
          } else {
            replyText += `• ⚠️ *"${it.solicitado}"* (Consultar disponibilidad en mostrador)\n`;
          }
        });

        replyText += `\n💰 **TOTAL ESTIMADO: $ ${totalEstimado.toFixed(2)} UYU**`;
        if (client && discountPct > 0) {
          replyText += ` *(con descuento ${categoryName.toUpperCase()} del ${discountPct}% OFF aplicado)*`;
        }
        replyText += `\n\nPuede incorporar estos artículos a su presupuesto con el botón inferior para revisarlo o exportarlo a WhatsApp de Sucursal Martínez.`;

        return res.json({
          success: true,
          reply: replyText,
          isMaterialList: true,
          listaItems: matchedProducts,
          productos: matchedProducts.filter((it) => it.encontrado),
          totalEstimado,
          totalAhorro,
          cliente: client ? {
            nombre: client.nombre,
            categoria: client.categoria,
            descuento_porcentaje: discountPct,
          } : null,
          transcription: mediaResult.transcribedTexts.join(' ').trim() || null,
          mediaAnalysis: {
            identifiedParts: mediaResult.identifiedParts,
            visualSearchTerms: mediaResult.visualSearchTerms,
            summaries: mediaResult.mediaSummaries,
          },
          conversationId,
          latencyMs: Date.now() - startTime,
        });
      }

      // 1. Detect Intent and Emotion
      const intentAnalysis = intentDetector.detectIntent(trimmedMessage);
      const detectedEmotion = intentAnalysis.emotion || 'neutral';
      const detectedIntent = intentAnalysis.intent || 'consulta_general';
      const messageCount = (history.filter((h) => h.role === 'user').length || 0) + 1;
      const channelPolicy = channelPolicyService.resolveChannelPolicy('web');

      // 2. Build Profile String with Discount Awareness
      let customerProfileStr = `DATOS DEL CLIENTE EN KROSER MARTÍNEZ (COTIZADOR OFICIAL):
- Nombre: ${clientName}
- Canal de origen: Cotizador Web Kroser Martínez (40 Años de Trayectoria)
- ROL: Eres el Asesor Técnico y de Mostrador de Kroser Martínez (Uruguay). Responde con tono profesional, sobrio, ejecutivo y cordial de ferretería tradicional, sin modismos de robot o IA.\n`;

      if (client && discountPct > 0) {
        customerProfileStr += `- Nivel de Cliente Registrado: ${categoryName.toUpperCase()}
- Porcentaje de Descuento Activo: ${discountPct}% OFF en todas sus compras
- INSTRUCCIÓN DE PRECIOS BONIFICADOS: Este cliente cuenta con un ${discountPct}% de descuento por pertenecer a la categoría ${categoryName}. Al cotizar o sugerir productos, mencione explícitamente el precio de lista y su precio final con descuento aplicado, destacando su ahorro.\n\n`;
      } else {
        customerProfileStr += `- Nivel de Cliente: Consumidor General (Sin descuento gremial activado aún).
- Si consulta por compras por mayor, reformas o es técnico/instalador, sugiérale amablemente crearse una cuenta o iniciar sesión en Kroser Martínez para acceder a descuentos de Gremio (15%) o Empresa (20%).\n\n`;
      }

      customerProfileStr += `- INTERFAZ WEB KROSER MARTÍNEZ: Cuando recomiendes artículos, la pantalla muestra tarjetas con botones "➕ Agregar a Cotización". Si el cliente escribe "agrega el primero", "agregalo a cotización", etc., indícale que ya puede tocar el botón de la tarjeta para sumarlo a su presupuesto y exportarlo a WhatsApp cuando desee.\n\n`;

      // 3. Assemble System Prompt
      const systemPrompt = await promptBuilder.buildSystemPrompt({
        customerProfileStr,
        detectedEmotion,
        detectedIntent,
        messageCount,
        customerName: clientName,
        channelPolicy,
      });

      // 4. Provider and Models
      const activeProvider = (await configuracionRepo.get('llm_provider')) || process.env.LLM_PROVIDER || 'gemini';
      const activeModel = (await configuracionRepo.get('llm_model')) || process.env.LLM_MODEL || (activeProvider === 'openai' ? 'gpt-4o-mini' : 'gemini-1.5-flash');

      const safeHistory = (Array.isArray(history) ? history : [])
        .slice(-10)
        .map((m) => {
          const role = (m && m.role === 'assistant') ? 'assistant' : 'user';
          const content = typeof m?.content === 'string' ? m.content.slice(0, 2000).trim() : '';
          return { role, content };
        })
        .filter((m) => m.content.length > 0);

      const userMessages = [
        ...safeHistory,
        { role: 'user', content: trimmedMessage },
      ];

      const toolContext = {
        conversationId,
        accountId: 1,
        channel: 'landing_cotibot',
        channelPolicy,
        customerName: clientName,
        cliente: client,
        lastUserMessage: trimmedMessage,
      };

      let llmResult = { reply: '', rawReply: '', toolsUsed: [], createdOrder: null };
      try {
        llmResult = await llmService.generateWithTools(systemPrompt, userMessages, {
          provider: activeProvider,
          model: activeModel,
          toolContext,
        });
      } catch (err) {
        logger.warn('[CotibotController] LLM Call Fallback', { error: err.message });
        llmResult.reply = `¡Hola! Soy Cotibot, tu asistente inteligente de cotizaciones de Kroser. En este momento estamos consultando el catálogo para responderte sobre "${trimmedMessage}". ¿Te gustaría ver las categorías principales o buscar algún modelo específico?`;
      }

      // 5. Order Extraction if conversation reached confirmation
      let finalReply = llmResult.reply;
      let finalCreatedOrder = llmResult.createdOrder;

      if (!finalCreatedOrder && finalReply.toLowerCase().includes('pedido')) {
        const { cleanReply, createdOrder } = await orderExtractor.processOrderFromReply({
          rawReply: finalReply,
          history: userMessages,
          conversationId,
          accountId: 1,
          channel: 'landing_cotibot',
        });
        finalReply = cleanReply;
        finalCreatedOrder = createdOrder;
      }

      // Extract products found in tools (aggregating across all buscar_productos calls)
      const allProdTools = llmResult.toolsUsed.filter((t) => t.name === 'buscar_productos');
      const allRawFound = [];
      allProdTools.forEach((t) => {
        if (t.result && Array.isArray(t.result.productos)) {
          allRawFound.push(...t.result.productos);
        }
      });

      const foundProducts = allRawFound.map((p) => {
        return {
          id: p.id,
          sku: p.sku,
          nombre: p.nombre,
          precio_texto: p.precio,
          precio_numerico: p.precio_numerico,
          moneda: p.moneda || 'UYU',
          marca: p.marca,
          enlace_web: p.enlace_web,
          stock_status: p.stock_status,
        };
      });

      finalReply = channelPolicyService.clampReply(finalReply, channelPolicy);
      finalReply = guardrailService.filterOutput(finalReply);

      const latencyMs = Date.now() - startTime;

      // Log assistant message asynchronously
      conversacionesRepo.logMessage(conversationId, finalReply, 'assistant').catch(() => {});

      return res.json({
        success: true,
        reply: finalReply,
        productos: foundProducts,
        pedidoCreated: finalCreatedOrder,
        cliente: client ? {
          nombre: client.nombre,
          categoria: client.categoria,
          descuento_porcentaje: discountPct,
        } : null,
        transcription: mediaResult.transcribedTexts.join(' ').trim() || null,
        mediaAnalysis: {
          identifiedParts: mediaResult.identifiedParts,
          visualSearchTerms: mediaResult.visualSearchTerms,
          summaries: mediaResult.mediaSummaries,
        },
        conversationId,
        latencyMs,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Crea un pedido desde la web / cotizador online
   */
  async createWebPedido(req, res, next) {
    try {
      const { cliente = {}, items = [], deliveryType = 'envio', notas = '' } = req.body;

      const pedidosEnabled = await configuracionRepo.get('pedidos_enabled');
      if (pedidosEnabled === 'false') {
        return res.status(403).json({
          success: false,
          error: 'La recepción de pedidos web está momentáneamente deshabilitada. Puede consultar vía WhatsApp o en nuestras sucursales.',
        });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'La cotización no contiene artículos para pedir.' });
      }
      if (items.length > 50) {
        return res.status(400).json({ success: false, error: 'Un pedido web no puede contener más de 50 artículos diferentes.' });
      }

      const nombre = (cliente.nombre || '').trim();
      const telefono = (cliente.telefono || '').trim();
      if (!nombre) {
        return res.status(400).json({ success: false, error: 'El nombre completo es requerido.' });
      }
      if (!telefono || telefono.length < 6) {
        return res.status(400).json({ success: false, error: 'Un número de teléfono/WhatsApp válido es requerido.' });
      }

      const direccion = deliveryType === 'retiro'
        ? (cliente.sucursal_retiro || 'Retiro en Sucursal Kroser')
        : (cliente.direccion || '').trim();

      if (deliveryType === 'envio' && !direccion) {
        return res.status(400).json({ success: false, error: 'La dirección de entrega es requerida para envíos a domicilio.' });
      }

      const clientAuth = req.cliente;
      const normalizedItems = [];
      for (const it of items) {
        const rawCant = parseInt(it.cantidad, 10);
        const cant = (isNaN(rawCant) || rawCant < 1) ? 1 : Math.min(999, rawCant);

        let finalUnitPrecio = 0;
        let finalMoneda = 'UYU';
        let finalNombre = String(it.nombre || 'Artículo').trim().slice(0, 150);
        let finalSku = String(it.sku || 'SKU-WEB').trim().slice(0, 50);

        // Seguridad: consultar producto oficial en catálogo para evitar manipulación de precios desde el cliente
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
          finalMoneda = catalogProd.moneda || 'UYU';

          // Calcular precio oficial verificado con descuentos autorizados del cliente
          const priced = pricingCalculator.calculateProductPrice(catalogProd, clientAuth);
          finalUnitPrecio = priced?.precio_final || parseFloat(catalogProd.precio_oferta || catalogProd.precio) || 0;
        } else {
          // Si el producto no se encuentra en el catálogo (artículo especial bajo consulta), validar precio
          const userPrice = parseFloat(it.precio_final || it.precio || 0);
          finalUnitPrecio = (!isNaN(userPrice) && userPrice >= 0 && userPrice < 1000000) ? userPrice : 0;
          finalMoneda = it.moneda || 'UYU';
        }

        normalizedItems.push({
          sku: finalSku,
          nombre: finalNombre,
          cantidad: cant,
          precio: Math.round(finalUnitPrecio * 100) / 100,
          moneda: finalMoneda,
          subtotal: Math.round(cant * finalUnitPrecio * 100) / 100,
        });
      }

      const totalMonto = Math.round(normalizedItems.reduce((acc, it) => acc + it.subtotal, 0) * 100) / 100;
      const normalizedCliente = {
        nombre,
        telefono,
        email: (cliente.email || (clientAuth ? clientAuth.email : '')).trim(),
        direccion,
        sucursal_retiro: deliveryType === 'retiro' ? (cliente.sucursal_retiro || '') : '',
        modalidad_entrega: deliveryType === 'retiro' ? 'Retiro en Sucursal' : 'Envío a Domicilio',
        forma_pago: cliente.forma_pago || 'A coordinar',
        notas: (notas || cliente.notas || '').trim(),
        cliente_id: clientAuth ? clientAuth.id : null,
        categoria: clientAuth ? clientAuth.categoria : 'minorista',
        descuento_porcentaje: clientAuth ? clientAuth.descuento_porcentaje : 0,
      };

      const createdOrder = await pedidosRepo.create({
        conversation_id: `web_cotibot_${Date.now()}`,
        account_id: 1,
        cliente: normalizedCliente,
        items: normalizedItems,
        origen: 'web',
        pago_estado: 'sin_pago',
        estado_inicial: 'pendiente',
      });

      logger.info('[CotibotController] Web order created successfully', {
        pedidoId: createdOrder.id,
        cliente: normalizedCliente.nombre,
        itemsCount: normalizedItems.length,
        total: totalMonto,
      });

      try {
        await emailService.sendNewOrderAlert(createdOrder);
      } catch (mailErr) {
        logger.warn('[CotibotController] Alert email error', { error: mailErr.message });
      }

      return res.status(201).json({
        success: true,
        pedido: {
          id: createdOrder.id,
          referencia: `#${createdOrder.id}`,
          cliente: normalizedCliente.nombre,
          telefono: normalizedCliente.telefono,
          modalidad_entrega: normalizedCliente.modalidad_entrega,
          direccion: normalizedCliente.direccion,
          total: totalMonto,
          moneda: normalizedItems[0]?.moneda || 'UYU',
          items: normalizedItems,
          created_at: createdOrder.created_at,
        },
      });
    } catch (err) {
      logger.error('[CotibotController] Error creating web pedido', { error: err.message });
      next(err);
    }
  },
};

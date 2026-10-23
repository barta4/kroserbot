const pedidosRepo = require('../../repositories/pedidosRepository');
const logger = require('../../config/logger');

/**
 * Extracts order ID or order reference from customer message text
 */
function extractOrderIdentifier(text = '') {
  if (!text) return null;
  const clean = text.trim();

  // Guardrail: technical hardware specifications (e.g. "tornillo #8", "mecha #6", "lija al agua #120")
  const isHardwareSpec = /\b(?:tornillo|tornillos|mecha|mechas|lija|lijas|grano|calibre|chapa|chapas|broca|brocas|rosca|alambre|canaleta|arandela|tuerca|perno)\s*#\s*[0-9]{1,4}\b/i.test(clean);
  if (isHardwareSpec) return null;

  // 1. Matches with semantic order keywords: pedido #1042, orden 1042, compra 1042, numero 1042, seguimiento 1042, ref 1042
  const keywordMatch = clean.match(/(?:pedido|orden|compra|nro|numero|número|seguimiento|ref|rastreo)\s*(?:n[°o]?\s*)?#?\s*([0-9]{1,8})\b/i);
  if (keywordMatch) return keywordMatch[1];

  // 2. Matches standalone #1042, # 1042 ONLY if at least 4 digits (to avoid confusing with tool or screw sizes like #6, #8)
  const hashMatch = clean.match(/#\s*([0-9]{4,8})\b/);
  if (hashMatch) return hashMatch[1];

  // 3. Matches: alphanumeric codes like KRO-1042, EC-5542, ORD-1234
  const codeMatch = clean.match(/\b([A-Z]{2,4}-[0-9]{2,8})\b/i);
  if (codeMatch) return codeMatch[1];

  return null;
}

/**
 * Formats order status into clear, polite Uruguayan Spanish
 */
function formatStatusMessage(pedido) {
  if (!pedido) return null;

  const cliente = typeof pedido.cliente === 'string' ? JSON.parse(pedido.cliente) : (pedido.cliente || {});
  const items = typeof pedido.items === 'string' ? JSON.parse(pedido.items) : (pedido.items || []);
  const orderRef = pedido.ecommerce_order_number || `#${pedido.id}`;

  let itemsSummary = '';
  if (Array.isArray(items) && items.length > 0) {
    itemsSummary = items.map((it) => `${it.nombre || it.sku || 'Artículo'} (x${it.cantidad || 1})`).join(', ');
  }

  let statusExplanation = '';
  switch (pedido.estado) {
    case 'pendiente':
      statusExplanation = `su pedido ${orderRef} se encuentra en **Revisión Comercial y Control de Stock**. En breve un asesor le confirmará la preparación.`;
      break;
    case 'confirmado':
      statusExplanation = `su pedido ${orderRef} está **Confirmado** y en cola para preparación en depósito.`;
      break;
    case 'en_preparacion':
      statusExplanation = `su pedido ${orderRef} está **En Preparación en Depósito**. Se están embalando sus artículos para su entrega o retiro.`;
      break;
    case 'entregado':
      statusExplanation = `su pedido ${orderRef} figura como **Entregado / Despachado**.`;
      if (cliente.direccion) {
        statusExplanation += ` Destino: ${cliente.direccion}.`;
      }
      break;
    case 'rechazado':
      statusExplanation = `su pedido ${orderRef} figura como **Rechazado**${pedido.motivo_modificacion ? ` (Motivo: ${pedido.motivo_modificacion})` : ''}. Si precisa asistencia, con gusto le derivamos con Administración.`;
      break;
    case 'cancelado':
      statusExplanation = `su pedido ${orderRef} figura como **Cancelado**.`;
      break;
    default:
      statusExplanation = `su pedido ${orderRef} se encuentra en estado **${pedido.estado}**.`;
  }

  let fullReply = `Estimado/a ${cliente.nombre || 'cliente'}, ${statusExplanation}`;
  if (itemsSummary) {
    fullReply += `\n📦 **Artículos:** ${itemsSummary}.`;
  }
  if (cliente.sucursal_retiro) {
    fullReply += `\n🏪 **Retiro:** Sucursal ${cliente.sucursal_retiro}.`;
  }

  return fullReply;
}

/**
 * Formats sanitized status message without PII for unverified requestors
 */
function formatStatusMessageSanitized(pedido) {
  if (!pedido) return null;
  const orderRef = pedido.ecommerce_order_number || `#${pedido.id}`;
  let statusExplanation = '';
  switch (pedido.estado) {
    case 'pendiente':
      statusExplanation = 'se encuentra en **Revisión Comercial y Control de Stock**.';
      break;
    case 'confirmado':
      statusExplanation = 'está **Confirmado** en cola para depósito.';
      break;
    case 'en_preparacion':
      statusExplanation = 'está **En Preparación en Depósito**.';
      break;
    case 'entregado':
      statusExplanation = 'figura como **Entregado / Despachado**.';
      break;
    case 'rechazado':
      statusExplanation = 'figura como **Rechazado**.';
      break;
    case 'cancelado':
      statusExplanation = 'figura como **Cancelado**.';
      break;
    default:
      statusExplanation = `se encuentra en estado **${pedido.estado}**.`;
  }
  return `El pedido ${orderRef} ${statusExplanation} (Por políticas de privacidad, para consultar el detalle de artículos o dirección de entrega, debe consultar desde el mismo WhatsApp o confirmar el teléfono registrado).`;
}

module.exports = {
  extractOrderIdentifier,
  formatStatusMessage,
  formatStatusMessageSanitized,

  async getTrackingInfo({ text = '', conversationId = null, sender = {}, clientPayload = {} } = {}) {
    try {
      const extractedId = extractOrderIdentifier(text);
      const phone = sender.phone_number || clientPayload.phone || clientPayload.telefono || '';

      logger.info('Looking up order tracking', { extractedId, phone, conversationId });

      let pedido = null;

      // 1. If explicit ID found in text, search by that ID first
      if (extractedId) {
        pedido = await pedidosRepo.searchOrderForTracking({
          orderId: extractedId,
          orderNumber: extractedId,
        });
      }

      // 2. If not found by explicit ID, search by conversation ID
      if (!pedido && conversationId) {
        pedido = await pedidosRepo.searchOrderForTracking({
          conversationId,
        });
      }

      // 3. If still not found, search by phone
      if (!pedido && phone) {
        pedido = await pedidosRepo.searchOrderForTracking({
          phone,
        });
      }

      if (!pedido) {
        return {
          hasOrder: false,
          pedido: null,
          contextStr: '',
          directReply: extractedId
            ? `No encontramos ningún pedido registrado con el número #${extractedId}. Por favor verifique el número o facilítenos su teléfono registrado.`
            : null,
        };
      }

      const cliente = typeof pedido.cliente === 'string' ? JSON.parse(pedido.cliente) : (pedido.cliente || {});
      const reqPhoneClean = String(phone).replace(/\D/g, '').slice(-8);
      const orderPhoneClean = String(cliente.telefono || cliente.whatsapp || '').replace(/\D/g, '').slice(-8);

      // Verificación de identidad para prevenir IDOR y fuga de PII a terceros
      const matchesConversation = Boolean(conversationId && pedido.conversation_id === conversationId);
      const matchesPhone = Boolean(reqPhoneClean.length >= 7 && orderPhoneClean.length >= 7 && reqPhoneClean === orderPhoneClean);
      const clientId = clientPayload.id || clientPayload.cliente_id;
      const matchesClientAuth = Boolean(clientId && cliente.cliente_id && String(clientId) === String(cliente.cliente_id));

      const isVerifiedOwner = matchesConversation || matchesPhone || matchesClientAuth;

      // Si no es el titular verificado, responder sin datos sensibles (nombre, dirección, artículos)
      const formattedReply = isVerifiedOwner
        ? formatStatusMessage(pedido)
        : formatStatusMessageSanitized(pedido);

      const orderRef = pedido.ecommerce_order_number || `#${pedido.id}`;

      const contextStr = isVerifiedOwner
        ? `ESTADO DE PEDIDO ENCONTRADO EN SISTEMA:
- Pedido: ${orderRef}
- Estado actual: ${pedido.estado.toUpperCase()}
- Origen: ${pedido.origen || 'bot'}
- Pago: ${pedido.pago_estado || 'sin_pago'}
- Detalle: ${formattedReply}
IMPORTANTE: Si el cliente pregunta por el estado de su pedido o entrega, responda directamente con esta información de forma cordial y concisa.\n\n`
        : `ESTADO DE PEDIDO ENCONTRADO (PROTEGIDO POR PRIVACIDAD):
- Pedido: ${orderRef}
- Estado actual: ${pedido.estado.toUpperCase()}
- Detalle: ${formattedReply}
IMPORTANTE: Por razones de seguridad y privacidad, NO revele nombres, direcciones de entrega ni teléfonos de pedidos a usuarios no verificados.\n\n`;

      return {
        hasOrder: true,
        pedido,
        orderRef,
        status: pedido.estado,
        directReply: formattedReply,
        contextStr,
        isVerifiedOwner,
      };
    } catch (err) {
      logger.warn('Error in order tracking service', { error: err.message });
      return { hasOrder: false, pedido: null, contextStr: '', directReply: null };
    }
  },
};

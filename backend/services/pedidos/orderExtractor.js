const pedidosRepo = require('../../repositories/pedidosRepository');
const configuracionRepo = require('../../repositories/configuracionRepository');
const emailService = require('../email/emailService');
const logger = require('../../config/logger');

/**
 * Extracts and creates an order if the AI response or conversation contains a confirmed order.
 */
module.exports = {
  /**
   * Parses the LLM reply for [REGISTRAR_PEDIDO: {...}] tag.
   * If found, cleans the tag from the user-facing text and persists the order to DB.
   */
  async processOrderFromReply({ rawReply = '', history = [], conversationId = null, accountId = 1, channel = 'bot' }) {
    let cleanReply = rawReply;
    let createdOrder = null;

    // 1. Check for [REGISTRAR_PEDIDO: {...}] tag
    const tagMatch = rawReply.match(/\[REGISTRAR_PEDIDO:\s*(\{[\s\S]*\})\s*\]/i);

    if (tagMatch) {
      try {
        const orderData = JSON.parse(tagMatch[1]);
        cleanReply = rawReply.replace(tagMatch[0], '').trim();

        const cliente = orderData.cliente || {};
        const items = Array.isArray(orderData.items) ? orderData.items : [];

        // Validate minimum required fields
        if (items.length > 0) {
          // Normalize items
          const normalizedItems = items.map((item) => ({
            sku: String(item.sku || 'SKU-TEMP'),
            nombre: String(item.nombre || 'Artículo'),
            cantidad: parseInt(item.cantidad, 10) || 1,
            precio: parseFloat(item.precio) || 0,
            subtotal: (parseInt(item.cantidad, 10) || 1) * (parseFloat(item.precio) || 0),
          }));

          const normalizedCliente = {
            nombre: cliente.nombre || 'Cliente Kroser',
            telefono: cliente.telefono || '',
            direccion: cliente.direccion || cliente.sucursal_retiro || 'A coordinar',
            email: cliente.email || '',
            sucursal_retiro: cliente.sucursal_retiro || '',
            forma_pago: cliente.forma_pago || 'A coordinar',
            notas: cliente.notas || '',
          };

          createdOrder = await pedidosRepo.create({
            conversation_id: conversationId || `sim_${Date.now()}`,
            account_id: accountId || 1,
            cliente: normalizedCliente,
            items: normalizedItems,
            origen: channel === 'Web Simulator' || channel === 'webwidget' ? 'simulador' : 'bot',
            pago_estado: 'sin_pago',
            estado_inicial: 'pendiente',
          });

          logger.info('Order automatically created from chat conversation', {
            pedidoId: createdOrder.id,
            cliente: normalizedCliente.nombre,
            itemCount: normalizedItems.length,
          });

          // Send alert email asynchronously
          try {
            await emailService.sendNewOrderAlert(createdOrder);
          } catch (err) {
            logger.warn('Order alert email dispatch failed', { pedidoId: createdOrder.id, error: err.message });
          }
        }
      } catch (err) {
        logger.error('Failed to parse REGISTRAR_PEDIDO tag JSON', { error: err.message, rawTag: tagMatch[1] });
      }
    }

    // 2. Heuristic fallback: If customer provided full order details in last messages and assistant confirms taking it
    if (!createdOrder && history.length >= 2) {
      const lastUserMsg = (history[history.length - 1]?.content || '').toLowerCase();
      const assistantText = cleanReply.toLowerCase();

      const isConfirmation =
        assistantText.includes('pedido registrado') ||
        assistantText.includes('tomamos su pedido') ||
        assistantText.includes('hemos registrado su pedido') ||
        assistantText.includes('pedido confirmado') ||
        assistantText.includes('coordinar la entrega') ||
        assistantText.includes('su pedido fue tomado');

      const hasContactData =
        /\b(09\d{7}|\d{8,9})\b/.test(lastUserMsg) ||
        lastUserMsg.includes('nombre') ||
        lastUserMsg.includes('tel') ||
        lastUserMsg.includes('dirección') ||
        lastUserMsg.includes('direccion') ||
        lastUserMsg.includes('calle');

      if (isConfirmation && hasContactData) {
        try {
          const phoneMatch = lastUserMsg.match(/\b(09\d{7}|\d{8,9})\b/);
          const telefono = phoneMatch ? phoneMatch[1] : '';

          const fallbackOrder = await pedidosRepo.create({
            conversation_id: conversationId || `sim_${Date.now()}`,
            account_id: accountId || 1,
            cliente: {
              nombre: 'Cliente Kroser',
              telefono,
              direccion: 'Detalle en conversación',
              notas: `Extraído de conversación: "${history[history.length - 1]?.content}"`,
            },
            items: [
              {
                sku: 'PEDIDO-CHAT',
                nombre: 'Artículos solicitados en chat',
                cantidad: 1,
                precio: 0,
                subtotal: 0,
              },
            ],
            origen: channel === 'Web Simulator' || channel === 'webwidget' ? 'simulador' : 'bot',
            pago_estado: 'sin_pago',
            estado_inicial: 'pendiente',
          });

          createdOrder = fallbackOrder;
          logger.info('Fallback order created from conversation cues', { pedidoId: fallbackOrder.id });
        } catch (_fErr) {}
      }
    }

    return {
      cleanReply,
      createdOrder,
    };
  },
};

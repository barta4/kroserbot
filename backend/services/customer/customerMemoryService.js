const pedidosRepo = require('../../repositories/pedidosRepository');
const conversacionesRepo = require('../../repositories/conversacionesRepository');
const logger = require('../../config/logger');

module.exports = {
  async getCustomerProfileContext({ conversationId, sender = {}, clientPayload = {} }) {
    try {
      const name = sender.name || clientPayload.name || '';
      const email = sender.email || clientPayload.email || '';
      const phone = sender.phone_number || clientPayload.phone || clientPayload.telefono || '';

      const pastOrders = await pedidosRepo.getOrdersByCustomerContext({
        conversation_id: conversationId,
        email,
        phone,
      });

      const recentTopics = await conversacionesRepo.getRecentTopics(conversationId, 4);

      let contextStr = '';
      if (name || pastOrders.length > 0 || recentTopics.length > 0) {
        contextStr += 'INFORMACIÓN Y ANTECEDENTES DEL CLIENTE:\n';
        if (name) contextStr += `- Nombre del cliente: ${name}\n`;
        if (phone) contextStr += `- Teléfono registrado: ${phone}\n`;
        if (email) contextStr += `- Email registrado: ${email}\n`;

        if (pastOrders.length > 0) {
          contextStr += '- Pedidos anteriores registrados:\n';
          pastOrders.forEach((p) => {
            let itemSummary = 'Productos varios';
            if (Array.isArray(p.items)) {
              itemSummary = p.items.map((it) => `${it.nombre || it.sku || 'Item'} (x${it.cantidad || 1})`).join(', ');
            } else if (typeof p.items === 'object' && p.items !== null) {
              itemSummary = JSON.stringify(p.items).substring(0, 80);
            }
            const dateStr = p.created_at ? new Date(p.created_at).toLocaleDateString('es-UY') : '';
            contextStr += `  * Pedido #${p.id} (${dateStr}) - Estado: ${p.estado} - Artículos: ${itemSummary}\n`;
          });
        }

        if (recentTopics.length > 1) {
          contextStr += `- Temas consultados recientemente en la conversación: "${recentTopics.slice(1).join(' | ').substring(0, 150)}"\n`;
        }

        contextStr += '\n';
      }

      return {
        contextStr,
        name,
        email,
        phone,
        hasPastOrders: pastOrders.length > 0,
        pastOrders,
      };
    } catch (err) {
      logger.warn('Error fetching customer profile context', { error: err.message });
      return { contextStr: '', name: '', email: '', phone: '', hasPastOrders: false, pastOrders: [] };
    }
  },
};

const pedidosService = require('../services/pedidos/pedidosService');
const pedidosRepo = require('../repositories/pedidosRepository');

module.exports = {
  async createPedido(req, res, next) {
    try {
      const { conversation_id, account_id, cliente, items } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'El pedido debe contener al menos un ítem' });
      }

      const pedido = await pedidosService.createOrder({
        conversation_id: conversation_id || 'manual',
        account_id: account_id || 1,
        cliente: cliente || {},
        items,
      });

      res.status(201).json(pedido);
    } catch (err) {
      next(err);
    }
  },

  async listPedidos(req, res, next) {
    try {
      const { estado, limit, offset } = req.query;
      const pedidos = await pedidosRepo.list({
        estado,
        limit: parseInt(limit || '50', 10),
        offset: parseInt(offset || '0', 10),
      });
      res.json(pedidos);
    } catch (err) {
      next(err);
    }
  },

  async getPedidoById(req, res, next) {
    try {
      const { id } = req.params;
      const pedido = await pedidosRepo.getById(id);
      if (!pedido) {
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }
      res.json(pedido);
    } catch (err) {
      next(err);
    }
  },

  async updateEstado(req, res, next) {
    try {
      const { id } = req.params;
      const { estado, cambiado_por } = req.body;

      if (!estado) {
        return res.status(400).json({ error: 'El campo estado es requerido' });
      }

      const pedidoActualizado = await pedidosService.updateOrderStatus(
        id,
        estado,
        cambiado_por || 'admin'
      );

      res.json(pedidoActualizado);
    } catch (err) {
      next(err);
    }
  },
};

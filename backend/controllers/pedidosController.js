const pedidosService = require('../services/pedidos/pedidosService');
const pedidosRepo = require('../repositories/pedidosRepository');
const { pedidoCreateSchema, pedidoEstadoSchema, pedidoUpdateSchema } = require('../schemas');
const { validate } = require('../schemas/validate');

module.exports = {
  async createPedido(req, res, next) {
    try {
      const result = validate(pedidoCreateSchema, req.body);
      if (!result.valid) {
        return res.status(400).json({ error: 'Payload inválido', details: result.errors });
      }
      const { conversation_id, account_id, cliente, items } = result.data;

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
      const parsedLimit = Math.min(parseInt(limit || '50', 10) || 50, 200);
      const parsedOffset = Math.max(parseInt(offset || '0', 10) || 0, 0);
      const pedidos = await pedidosRepo.list({
        estado,
        limit: parsedLimit,
        offset: parsedOffset,
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
      const result = validate(pedidoEstadoSchema, req.body);
      if (!result.valid) {
        return res.status(400).json({ error: 'Payload inválido', details: result.errors });
      }
      const { id } = req.params;
      const { estado, cambiado_por } = result.data;

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

  async updatePedido(req, res, next) {
    try {
      const result = validate(pedidoUpdateSchema, req.body);
      if (!result.valid) {
        return res.status(400).json({ error: 'Payload inválido', details: result.errors });
      }
      const { id } = req.params;
      const { items, cliente, estado, notas, motivo_modificacion, zona_envio_id, forma_pago_id, costo_envio, cambiado_por } = result.data;

      const pedidoActualizado = await pedidosRepo.updateFull(
        id,
        { items, cliente, estado, notas, motivo_modificacion, zona_envio_id, forma_pago_id, costo_envio },
        cambiado_por || 'admin'
      );

      res.json(pedidoActualizado);
    } catch (err) {
      next(err);
    }
  },
};

const db = require('../config/db');

module.exports = {
  async create({ conversation_id, account_id, cliente, items }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const insertRes = await client.query(
        `INSERT INTO pedidos (conversation_id, account_id, cliente, items, estado, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'pendiente', NOW(), NOW())
         RETURNING *`,
        [conversation_id, account_id, JSON.stringify(cliente), JSON.stringify(items)]
      );
      const pedido = insertRes.rows[0];

      await client.query(
        `INSERT INTO pedidos_historial (pedido_id, estado_anterior, estado_nuevo, cambiado_por, created_at)
         VALUES ($1, NULL, 'pendiente', 'system_bot', NOW())`,
        [pedido.id]
      );

      await client.query('COMMIT');
      return pedido;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async updateEstado(id, nuevoEstado, cambiadoPor = 'admin') {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      
      const currentRes = await client.query('SELECT estado FROM pedidos WHERE id = $1 FOR UPDATE', [id]);
      if (currentRes.rows.length === 0) {
        throw new Error(`Pedido ${id} no existe`);
      }
      const estadoAnterior = currentRes.rows[0].estado;

      const updateRes = await client.query(
        `UPDATE pedidos 
         SET estado = $1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING *`,
        [nuevoEstado, id]
      );
      const pedidoActualizado = updateRes.rows[0];

      await client.query(
        `INSERT INTO pedidos_historial (pedido_id, estado_anterior, estado_nuevo, cambiado_por, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [id, estadoAnterior, nuevoEstado, cambiadoPor]
      );

      await client.query('COMMIT');
      return { pedido: pedidoActualizado, estadoAnterior };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async getById(id) {
    const res = await db.query('SELECT * FROM pedidos WHERE id = $1', [id]);
    return res.rows[0] || null;
  },

  async getActiveByConversation(conversation_id) {
    const res = await db.query(
      `SELECT * FROM pedidos 
       WHERE conversation_id = $1 AND estado = 'pendiente' 
       ORDER BY created_at DESC LIMIT 1`,
      [conversation_id]
    );
    return res.rows[0] || null;
  },

  async list({ estado, limit = 50, offset = 0 } = {}) {
    let sql = 'SELECT * FROM pedidos';
    const params = [];
    if (estado) {
      sql += ' WHERE estado = $1';
      params.push(estado);
    }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const res = await db.query(sql, params);
    return res.rows;
  },

  async getPendingOlderThanHours(hours = 2) {
    const res = await db.query(
      `SELECT * FROM pedidos 
       WHERE estado = 'pendiente' AND created_at < NOW() - ($1 || ' hours')::INTERVAL`,
      [hours]
    );
    return res.rows;
  },
};

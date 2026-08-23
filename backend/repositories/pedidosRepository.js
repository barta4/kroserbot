const db = require('../config/db');

module.exports = {
  async create({ conversation_id, account_id, cliente, items, origen, pago_estado, pago_referencia, ecommerce_order_number, estado_inicial }) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const estado = estado_inicial || 'pendiente';
      const insertRes = await client.query(
        `INSERT INTO pedidos (conversation_id, account_id, cliente, items, estado, origen, pago_estado, pago_referencia, ecommerce_order_number, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         RETURNING *`,
        [
          conversation_id,
          account_id,
          JSON.stringify(cliente),
          JSON.stringify(items),
          estado,
          origen || 'bot',
          pago_estado || 'sin_pago',
          pago_referencia || null,
          ecommerce_order_number || null,
        ]
      );
      const pedido = insertRes.rows[0];

      await client.query(
        `INSERT INTO pedidos_historial (pedido_id, estado_anterior, estado_nuevo, cambiado_por, created_at)
         VALUES ($1, NULL, $2, $3, NOW())`,
        [pedido.id, estado, origen === 'ecommerce' ? 'ecommerce_auto' : 'system_bot']
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

  async updateFull(id, { items, cliente, estado, notas, motivo_modificacion, zona_envio_id, forma_pago_id, costo_envio }, cambiadoPor = 'admin') {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const currentRes = await client.query('SELECT * FROM pedidos WHERE id = $1 FOR UPDATE', [id]);
      if (currentRes.rows.length === 0) {
        throw new Error(`Pedido ${id} no existe`);
      }
      const actual = currentRes.rows[0];

      const nuevoEstado = estado || actual.estado;

      const updateRes = await client.query(
        `UPDATE pedidos
         SET items = COALESCE($1, items),
             cliente = COALESCE($2, cliente),
             estado = $3,
             notas = $4,
             motivo_modificacion = $5,
             zona_envio_id = $6,
             forma_pago_id = $7,
             costo_envio = COALESCE($8, costo_envio),
             updated_at = NOW()
         WHERE id = $9
         RETURNING *`,
        [
          items ? JSON.stringify(items) : null,
          cliente ? JSON.stringify(cliente) : null,
          nuevoEstado,
          notas !== undefined ? notas : actual.notas,
          motivo_modificacion !== undefined ? motivo_modificacion : actual.motivo_modificacion,
          zona_envio_id || actual.zona_envio_id,
          forma_pago_id || actual.forma_pago_id,
          costo_envio !== undefined ? costo_envio : actual.costo_envio,
          id,
        ]
      );
      const pedidoActualizado = updateRes.rows[0];

      if (actual.estado !== nuevoEstado || motivo_modificacion) {
        await client.query(
          `INSERT INTO pedidos_historial (pedido_id, estado_anterior, estado_nuevo, cambiado_por, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [id, actual.estado, nuevoEstado, cambiadoPor]
        );
      }

      await client.query('COMMIT');
      return pedidoActualizado;
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

  async getByEcommerceOrderNumber(orderNumber) {
    if (!orderNumber) return null;
    const res = await db.query(
      'SELECT * FROM pedidos WHERE ecommerce_order_number = $1 LIMIT 1',
      [orderNumber]
    );
    return res.rows[0] || null;
  },

  async updatePagoEstado(id, pagoEstado, pagoReferencia) {
    const res = await db.query(
      `UPDATE pedidos 
       SET pago_estado = $1, pago_referencia = COALESCE($2, pago_referencia), updated_at = NOW() 
       WHERE id = $3 
       RETURNING *`,
      [pagoEstado, pagoReferencia, id]
    );
    return res.rows[0] || null;
  },

  async list({ estado, origen, limit = 50, offset = 0 } = {}) {
    let sql = 'SELECT * FROM pedidos';
    const params = [];
    const conditions = [];

    if (estado) {
      conditions.push(`estado = $${params.length + 1}`);
      params.push(estado);
    }
    if (origen) {
      conditions.push(`origen = $${params.length + 1}`);
      params.push(origen);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
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

  async getOrdersByCustomerContext({ conversation_id, email, phone }) {
    try {
      const conditions = [];
      const params = [];

      if (conversation_id) {
        conditions.push(`conversation_id = $${params.length + 1}`);
        params.push(String(conversation_id));
      }
      if (email) {
        conditions.push(`cliente->>'email' ILIKE $${params.length + 1}`);
        params.push(email);
      }
      if (phone) {
        conditions.push(`cliente->>'telefono' ILIKE $${params.length + 1}`);
        params.push(`%${phone}%`);
      }

      if (conditions.length === 0) return [];

      const sql = `
        SELECT id, estado, items, created_at, origen, ecommerce_order_number 
        FROM pedidos 
        WHERE ${conditions.join(' OR ')}
        ORDER BY created_at DESC 
        LIMIT 5
      `;
      const res = await db.query(sql, params);
      return res.rows;
    } catch (_err) {
      return [];
    }
  },
};

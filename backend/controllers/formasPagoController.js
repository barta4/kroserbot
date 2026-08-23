const db = require('../config/db');
const { formaPagoSchema } = require('../schemas');
const { validate } = require('../schemas/validate');

module.exports = {
  async listFormas(req, res, next) {
    try {
      const result = await db.query('SELECT * FROM formas_pago ORDER BY id ASC');
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  },

  async createForma(req, res, next) {
    try {
      const result = validate(formaPagoSchema, req.body);
      if (!result.valid) {
        return res.status(400).json({ error: 'Payload inválido', details: result.errors });
      }
      const { nombre, descripcion, instrucciones, activo } = result.data;

      const insertResult = await db.query(
        `INSERT INTO formas_pago (nombre, descripcion, instrucciones, activo)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [nombre, descripcion || '', instrucciones || '', activo !== undefined ? activo : true]
      );
      res.status(201).json(insertResult.rows[0]);
    } catch (err) {
      next(err);
    }
  },

  async updateForma(req, res, next) {
    try {
      const result = validate(formaPagoSchema, req.body);
      if (!result.valid) {
        return res.status(400).json({ error: 'Payload inválido', details: result.errors });
      }
      const { id } = req.params;
      const { nombre, descripcion, instrucciones, activo } = result.data;

      const updateResult = await db.query(
        `UPDATE formas_pago
         SET nombre = COALESCE($1, nombre),
             descripcion = COALESCE($2, descripcion),
             instrucciones = COALESCE($3, instrucciones),
             activo = COALESCE($4, activo)
         WHERE id = $5 RETURNING *`,
        [nombre, descripcion, instrucciones, activo, id]
      );

      if (updateResult.rows.length === 0) {
        return res.status(404).json({ error: 'Forma de pago no encontrada' });
      }
      res.json(updateResult.rows[0]);
    } catch (err) {
      next(err);
    }
  },

  async deleteForma(req, res, next) {
    try {
      const { id } = req.params;
      await db.query('DELETE FROM formas_pago WHERE id = $1', [id]);
      res.json({ success: true, message: `Forma de pago #${id} eliminada` });
    } catch (err) {
      next(err);
    }
  },
};

const db = require('../config/db');
const { zonaEnvioSchema } = require('../schemas');
const { validate } = require('../schemas/validate');

module.exports = {
  async listZonas(req, res, next) {
    try {
      const result = await db.query(
        'SELECT * FROM zonas_envio ORDER BY departamento_ciudad, barrio_zona'
      );
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  },

  async createZona(req, res, next) {
    try {
      const result = validate(zonaEnvioSchema, req.body);
      if (!result.valid) {
        return res.status(400).json({ error: 'Payload inválido', details: result.errors });
      }
      const { departamento_ciudad, barrio_zona, costo_envio, activo } = result.data;

      const insertResult = await db.query(
        `INSERT INTO zonas_envio (departamento_ciudad, barrio_zona, costo_envio, activo)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [
          departamento_ciudad || 'Montevideo',
          barrio_zona,
          parseFloat(costo_envio) || 0,
          activo !== undefined ? activo : true,
        ]
      );
      res.status(201).json(insertResult.rows[0]);
    } catch (err) {
      next(err);
    }
  },

  async updateZona(req, res, next) {
    try {
      const result = validate(zonaEnvioSchema, req.body);
      if (!result.valid) {
        return res.status(400).json({ error: 'Payload inválido', details: result.errors });
      }
      const { id } = req.params;
      const { departamento_ciudad, barrio_zona, costo_envio, activo } = result.data;

      const updateResult = await db.query(
        `UPDATE zonas_envio
         SET departamento_ciudad = COALESCE($1, departamento_ciudad),
             barrio_zona = COALESCE($2, barrio_zona),
             costo_envio = COALESCE($3, costo_envio),
             activo = COALESCE($4, activo)
         WHERE id = $5 RETURNING *`,
        [departamento_ciudad, barrio_zona, parseFloat(costo_envio) || 0, activo, id]
      );

      if (updateResult.rows.length === 0) {
        return res.status(404).json({ error: 'Zona de envío no encontrada' });
      }
      res.json(updateResult.rows[0]);
    } catch (err) {
      next(err);
    }
  },

  async deleteZona(req, res, next) {
    try {
      const { id } = req.params;
      await db.query('DELETE FROM zonas_envio WHERE id = $1', [id]);
      res.json({ success: true, message: `Zona #${id} eliminada` });
    } catch (err) {
      next(err);
    }
  },
};

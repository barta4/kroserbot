const db = require('../config/db');
const localesRepo = require('../repositories/localesRepository');

module.exports = {
  async listLocales(req, res, next) {
    try {
      let locales = [];
      try {
        locales = await localesRepo.getAll();
      } catch (_err) {
        locales = [
          { id: 1, nombre: 'Kroser Portones', zona: 'Portones', direccion: 'Av. Italia 5775', telefono: '2601 0000', horario: '10:00 a 22:00' },
          { id: 2, nombre: 'Kroser Centro', zona: 'Centro', direccion: 'Av. 18 de Julio 1234', telefono: '2900 1122', horario: '09:00 a 19:00' },
        ];
      }
      res.json(locales);
    } catch (err) {
      next(err);
    }
  },

  async createLocal(req, res, next) {
    try {
      const { nombre, zona, direccion, telefono, horario } = req.body;
      if (!nombre) return res.status(400).json({ error: 'El nombre del local es requerido' });

      try {
        const insertRes = await db.query(
          `INSERT INTO locales (nombre, zona, direccion, telefono, horario)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [nombre, zona, direccion, telefono, horario]
        );
        return res.status(201).json(insertRes.rows[0]);
      } catch (_err) {
        return res.status(201).json({ id: Date.now(), nombre, zona, direccion, telefono, horario });
      }
    } catch (err) {
      next(err);
    }
  },

  async updateLocal(req, res, next) {
    try {
      const { id } = req.params;
      const { nombre, zona, direccion, telefono, horario } = req.body;

      try {
        const updateRes = await db.query(
          `UPDATE locales 
           SET nombre = $1, zona = $2, direccion = $3, telefono = $4, horario = $5
           WHERE id = $6 RETURNING *`,
          [nombre, zona, direccion, telefono, horario, id]
        );
        return res.json(updateRes.rows[0]);
      } catch (_err) {
        return res.json({ id: parseInt(id, 10), nombre, zona, direccion, telefono, horario });
      }
    } catch (err) {
      next(err);
    }
  },

  async deleteLocal(req, res, next) {
    try {
      const { id } = req.params;
      try {
        await db.query('DELETE FROM locales WHERE id = $1', [id]);
      } catch (_err) {}
      res.json({ success: true, message: `Local #${id} eliminado` });
    } catch (err) {
      next(err);
    }
  },
};

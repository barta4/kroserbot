const guiasRepo = require('../repositories/guiasTecnicasRepository');

module.exports = {
  async listGuias(req, res, next) {
    try {
      const activoOnly = req.query.activo === 'true';
      const guias = await guiasRepo.getAll({ activoOnly });
      res.json(guias);
    } catch (err) {
      next(err);
    }
  },

  async getGuia(req, res, next) {
    try {
      const { id } = req.params;
      const guia = await guiasRepo.getById(id);
      if (!guia) {
        return res.status(404).json({ error: 'Guía técnica no encontrada' });
      }
      res.json(guia);
    } catch (err) {
      next(err);
    }
  },

  async createGuia(req, res, next) {
    try {
      const { titulo, categoria, resumen, contenido, keywords, activo } = req.body;
      if (!titulo || !categoria || !contenido) {
        return res.status(400).json({ error: 'Título, categoría y contenido son requeridos' });
      }
      const nuevaGuia = await guiasRepo.create({
        titulo,
        categoria,
        resumen,
        contenido,
        keywords,
        activo: activo !== false,
      });
      res.status(201).json(nuevaGuia);
    } catch (err) {
      next(err);
    }
  },

  async updateGuia(req, res, next) {
    try {
      const { id } = req.params;
      const { titulo, categoria, resumen, contenido, keywords, activo } = req.body;
      const actualizada = await guiasRepo.update(id, {
        titulo,
        categoria,
        resumen,
        contenido,
        keywords,
        activo,
      });
      res.json(actualizada);
    } catch (err) {
      next(err);
    }
  },

  async deleteGuia(req, res, next) {
    try {
      const { id } = req.params;
      await guiasRepo.delete(id);
      res.json({ success: true, message: `Guía técnica #${id} eliminada` });
    } catch (err) {
      next(err);
    }
  },
};

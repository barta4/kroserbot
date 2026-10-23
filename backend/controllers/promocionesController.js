const promocionesRepo = require('../repositories/promocionesRepository');
const logger = require('../config/logger');

module.exports = {
  async getActivePromociones(req, res, next) {
    try {
      const promociones = await promocionesRepo.getAllActive();
      return res.json({
        success: true,
        total: promociones.length,
        promociones,
      });
    } catch (err) {
      logger.error('Error in getActivePromociones controller', { error: err.message });
      next(err);
    }
  },

  async getAllPromociones(req, res, next) {
    try {
      const promociones = await promocionesRepo.getAll();
      return res.json({
        success: true,
        total: promociones.length,
        promociones,
      });
    } catch (err) {
      logger.error('Error in getAllPromociones controller', { error: err.message });
      next(err);
    }
  },

  async createPromocion(req, res, next) {
    try {
      const { titulo } = req.body;
      if (!titulo || typeof titulo !== 'string' || !titulo.trim()) {
        return res.status(400).json({
          error: 'El título de la promoción es obligatorio',
        });
      }

      const promocion = await promocionesRepo.create(req.body);
      return res.status(201).json({
        success: true,
        message: 'Promoción creada exitosamente',
        promocion,
      });
    } catch (err) {
      logger.error('Error in createPromocion controller', { error: err.message });
      next(err);
    }
  },

  async updatePromocion(req, res, next) {
    try {
      const { id } = req.params;
      const updated = await promocionesRepo.update(id, req.body);
      if (!updated) {
        return res.status(404).json({
          error: 'Promoción no encontrada',
        });
      }

      return res.json({
        success: true,
        message: 'Promoción actualizada con éxito',
        promocion: updated,
      });
    } catch (err) {
      logger.error('Error in updatePromocion controller', { error: err.message });
      next(err);
    }
  },

  async togglePromocion(req, res, next) {
    try {
      const { id } = req.params;
      const toggled = await promocionesRepo.toggle(id);
      if (!toggled) {
        return res.status(404).json({
          error: 'Promoción no encontrada',
        });
      }

      return res.json({
        success: true,
        message: `Promoción ${toggled.activo ? 'activada' : 'desactivada'} con éxito`,
        promocion: toggled,
      });
    } catch (err) {
      logger.error('Error in togglePromocion controller', { error: err.message });
      next(err);
    }
  },

  async deletePromocion(req, res, next) {
    try {
      const { id } = req.params;
      const deleted = await promocionesRepo.delete(id);
      if (!deleted) {
        return res.status(404).json({
          error: 'Promoción no encontrada',
        });
      }

      return res.json({
        success: true,
        message: 'Promoción eliminada con éxito',
        id: deleted.id,
      });
    } catch (err) {
      logger.error('Error in deletePromocion controller', { error: err.message });
      next(err);
    }
  },
};

const configuracionRepo = require('../repositories/configuracionRepository');

module.exports = {
  async getConfig(req, res, next) {
    try {
      const config = await configuracionRepo.getAll();
      res.json(config);
    } catch (err) {
      next(err);
    }
  },

  async updateConfig(req, res, next) {
    try {
      const { key, value } = req.body;
      if (!key || value === undefined) {
        return res.status(400).json({ error: 'Campos key y value son requeridos' });
      }
      const updated = await configuracionRepo.set(key, value);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
};

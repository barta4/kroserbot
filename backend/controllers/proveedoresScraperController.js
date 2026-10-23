const proveedoresRepo = require('../repositories/proveedoresScraperRepository');
const logger = require('../config/logger');

module.exports = {
  async getProveedores(req, res, next) {
    try {
      const proveedores = await proveedoresRepo.getAll();
      return res.json({
        total: proveedores.length,
        proveedores,
      });
    } catch (err) {
      logger.error('Error in getProveedores controller', { error: err.message });
      next(err);
    }
  },

  async updateProveedor(req, res, next) {
    try {
      const { codigo } = req.params;
      if (!codigo || typeof codigo !== 'string' || !/^[a-zA-Z0-9_-]{1,50}$/.test(codigo)) {
        return res.status(400).json({ error: 'Código de proveedor inválido' });
      }

      const body = req.body || {};
      const cleanFields = {};

      if (body.margen_porcentaje !== undefined) {
        const margen = parseFloat(body.margen_porcentaje);
        if (isNaN(margen) || !isFinite(margen) || margen < 0 || margen > 500) {
          return res.status(400).json({ error: 'margen_porcentaje debe ser un número válido entre 0 y 500' });
        }
        cleanFields.margen_porcentaje = margen;
      }

      if (body.moneda_defecto !== undefined) {
        if (!['UYU', 'USD'].includes(String(body.moneda_defecto).toUpperCase())) {
          return res.status(400).json({ error: 'moneda_defecto debe ser UYU o USD' });
        }
        cleanFields.moneda_defecto = String(body.moneda_defecto).toUpperCase();
      }

      if (body.prefijo_sku !== undefined) {
        if (typeof body.prefijo_sku !== 'string' || body.prefijo_sku.length > 20) {
          return res.status(400).json({ error: 'prefijo_sku debe tener como máximo 20 caracteres' });
        }
        cleanFields.prefijo_sku = body.prefijo_sku.trim();
      }

      if (body.nombre !== undefined) {
        if (typeof body.nombre !== 'string' || body.nombre.trim().length === 0 || body.nombre.length > 100) {
          return res.status(400).json({ error: 'nombre inválido (máximo 100 caracteres)' });
        }
        cleanFields.nombre = body.nombre.trim();
      }

      if (body.activo !== undefined) cleanFields.activo = Boolean(body.activo);
      if (body.costo_incluye_iva !== undefined) cleanFields.costo_incluye_iva = Boolean(body.costo_incluye_iva);
      if (body.aplicar_iva_venta !== undefined) cleanFields.aplicar_iva_venta = Boolean(body.aplicar_iva_venta);
      if (body.url_base !== undefined) cleanFields.url_base = typeof body.url_base === 'string' ? body.url_base.slice(0, 255) : null;
      if (body.notas !== undefined) cleanFields.notas = typeof body.notas === 'string' ? body.notas.slice(0, 1000) : null;

      const updated = await proveedoresRepo.update(codigo, cleanFields);
      return res.json({
        message: `Proveedor ${codigo} actualizado con éxito`,
        proveedor: updated,
      });
    } catch (err) {
      logger.error('Error in updateProveedor controller', { error: err.message });
      next(err);
    }
  },

  async recalcularPrecios(req, res, next) {
    try {
      const { codigo } = req.params;
      const resultado = await proveedoresRepo.recalcularPrecios(codigo);
      return res.json({
        message: `Precios recalculados para proveedor ${codigo}`,
        resultado,
      });
    } catch (err) {
      logger.error('Error in recalcularPrecios controller', { error: err.message });
      next(err);
    }
  },

  async recalcularTodos(req, res, next) {
    try {
      const resultados = await proveedoresRepo.recalcularTodos();
      return res.json({
        message: 'Precios recalculados para todos los proveedores activos',
        resultados,
      });
    } catch (err) {
      logger.error('Error in recalcularTodos controller', { error: err.message });
      next(err);
    }
  },

  async syncProveedor(req, res, next) {
    try {
      const { codigo } = req.params;
      if (!codigo || typeof codigo !== 'string' || !/^[a-zA-Z0-9_-]{1,50}$/.test(codigo)) {
        return res.status(400).json({ error: 'Código de proveedor inválido' });
      }

      const { products } = req.body || {};
      if (!Array.isArray(products)) {
        return res.status(400).json({ error: 'El campo "products" debe ser un array' });
      }
      if (products.length > 10000) {
        return res.status(400).json({ error: 'El array "products" supera el límite permitido de 10.000 items' });
      }

      const syncService = require('../services/scraper/multiScraperSyncService');
      const resultado = await syncService.syncProducts(codigo, products || []);
      return res.json({
        message: `Sincronización completada para proveedor ${codigo}`,
        resultado,
      });
    } catch (err) {
      logger.error('Error in syncProveedor controller', { error: err.message });
      next(err);
    }
  },
};

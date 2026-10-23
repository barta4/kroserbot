const clientesRepo = require('../repositories/clientesRepository');
const categoriasRepo = require('../repositories/categoriasDescuentoRepository');
const logger = require('../config/logger');

module.exports = {
  // --- Categorías Dinámicas de Descuento ---
  async listCategorias(req, res, next) {
    try {
      const { soloActivos } = req.query;
      const categorias = await categoriasRepo.getAll({ soloActivos: soloActivos === 'true' || soloActivos === '1' });
      res.json({ success: true, categorias });
    } catch (err) {
      next(err);
    }
  },

  async createCategoria(req, res, next) {
    try {
      const { codigo, nombre, descuento_porcentaje, orden, activo, descripcion } = req.body;
      if (!codigo || !nombre) {
        return res.status(400).json({ error: 'El código y nombre de la categoría son obligatorios' });
      }
      const existing = await categoriasRepo.getByCodigo(codigo);
      if (existing) {
        return res.status(409).json({ error: `Ya existe una categoría con el código '${codigo}'` });
      }
      const created = await categoriasRepo.create({
        codigo,
        nombre,
        descuento_porcentaje,
        orden,
        activo,
        descripcion,
      });
      logger.info('[ClientesAdmin] Nueva categoría de descuento creada por admin', { codigo: created.codigo, nombre });
      res.status(201).json({ success: true, categoria: created });
    } catch (err) {
      next(err);
    }
  },

  async updateCategoria(req, res, next) {
    try {
      const { codigo } = req.params;
      const { nombre, descuento_porcentaje, orden, activo, descripcion } = req.body;
      const updated = await categoriasRepo.update(codigo, {
        nombre,
        descuento_porcentaje,
        orden,
        activo,
        descripcion,
      });
      if (!updated) {
        return res.status(404).json({ error: 'Categoría no encontrada' });
      }
      logger.info('[ClientesAdmin] Categoría de descuento actualizada', { codigo, descuento_porcentaje });
      res.json({ success: true, categoria: updated });
    } catch (err) {
      next(err);
    }
  },

  async deleteCategoria(req, res, next) {
    try {
      const { codigo } = req.params;
      const result = await categoriasRepo.delete(codigo);
      if (!result) {
        return res.status(404).json({ error: 'Categoría no encontrada' });
      }
      logger.info('[ClientesAdmin] Categoría eliminada o desactivada', { codigo, result });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },

  // --- Clientes ---
  async listClientes(req, res, next) {
    try {
      const { search, categoria, limit = 50, offset = 0 } = req.query;
      const data = await clientesRepo.list({ search, categoria, limit, offset });
      res.json(data);
    } catch (err) {
      next(err);
    }
  },

  async getCliente(req, res, next) {
    try {
      const { id } = req.params;
      const cliente = await clientesRepo.findById(id);
      if (!cliente) {
        return res.status(404).json({ error: 'Cliente no encontrado' });
      }
      res.json({ success: true, cliente });
    } catch (err) {
      next(err);
    }
  },

  async updateCliente(req, res, next) {
    try {
      const { id } = req.params;
      const { categoria, descuento_porcentaje, activo, nombre, telefono, empresa_razon_social } = req.body;

      const fieldsToUpdate = {};
      if (categoria !== undefined) fieldsToUpdate.categoria = String(categoria).toLowerCase();
      if (descuento_porcentaje !== undefined) fieldsToUpdate.descuento_porcentaje = parseFloat(descuento_porcentaje);
      if (activo !== undefined) fieldsToUpdate.activo = Boolean(activo);
      if (nombre !== undefined) fieldsToUpdate.nombre = String(nombre).trim();
      if (telefono !== undefined) fieldsToUpdate.telefono = String(telefono).trim();
      if (empresa_razon_social !== undefined) fieldsToUpdate.empresa_razon_social = String(empresa_razon_social).trim();

      const updated = await clientesRepo.update(id, fieldsToUpdate);
      if (!updated) {
        return res.status(404).json({ error: 'Cliente no encontrado o no pudo actualizarse' });
      }

      logger.info('[ClientesAdmin] Cliente actualizado por admin', { id, categoria, descuento_porcentaje });
      res.json({ success: true, cliente: updated });
    } catch (err) {
      next(err);
    }
  },
};

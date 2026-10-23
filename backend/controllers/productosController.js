const pricingCalculator = require('../utils/pricingCalculator');
const productosRepo = require('../repositories/productosRepository');

function sanitizeProductForPublic(product, isStaff = false) {
  if (!product || typeof product !== 'object' || isStaff) return product;
  const { precio_costo, margen_aplicado, iva_aplicado, fuente_origen, ...safeProduct } = product;
  return safeProduct;
}

module.exports = {
  async listProductos(req, res, next) {
    try {
      const { search, categoria, marca, fuente_origen, promo_id, limit = 50, offset = 0, page } = req.query;
      const parsedLimit = Math.max(1, parseInt(limit, 10) || 50);
      let parsedOffset = Math.max(0, parseInt(offset, 10) || 0);
      if (page) {
        const parsedPage = Math.max(1, parseInt(page, 10) || 1);
        parsedOffset = (parsedPage - 1) * parsedLimit;
      }

      const { items, total } = await productosRepo.listWithPromociones({
        search,
        categoria,
        marca,
        fuente_origen,
        promo_id,
        limit: parsedLimit,
        offset: parsedOffset,
      });

      // Enriquecer con cálculo de precios según cliente o promoción activa
      const client = req.cliente || (req.user && req.user.role === 'cliente' ? req.user : null);
      const enrichedRows = pricingCalculator.enrichProductsWithPricing(items, client);
      const isStaff = Boolean(req.user && ['admin', 'supervisor'].includes(req.user.role));
      const safeRows = enrichedRows.map((p) => sanitizeProductForPublic(p, isStaff));

      const currentPage = Math.floor(parsedOffset / parsedLimit) + 1;
      const totalPages = Math.ceil(total / parsedLimit) || 1;

      res.json({
        items: safeRows,
        total,
        page: currentPage,
        totalPages,
        limit: parsedLimit,
        offset: parsedOffset,
        clienteDescuento: client ? {
          categoria: client.categoria,
          descuento_porcentaje: pricingCalculator.getEffectiveDiscount(client),
        } : null,
      });
    } catch (err) {
      next(err);
    }
  },

  async getProducto(req, res, next) {
    try {
      const { id } = req.params;
      const parsedId = parseInt(id, 10);
      if (isNaN(parsedId) || parsedId <= 0) {
        return res.status(400).json({ error: 'ID de producto inválido' });
      }

      const producto = await productosRepo.findByIdWithPromocion(parsedId);
      if (!producto) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      const client = req.cliente || (req.user && req.user.role === 'cliente' ? req.user : null);
      const enriched = pricingCalculator.calculateProductPrice(producto, client);
      const isStaff = Boolean(req.user && ['admin', 'supervisor'].includes(req.user.role));

      let alternativas = [];
      try {
        alternativas = await productosRepo.getAlternatives({
          categoria: enriched.categoria,
          marca: enriched.marca,
          excludeSku: enriched.sku,
          limit: 4,
        });
        alternativas = pricingCalculator.enrichProductsWithPricing(alternativas, client);
      } catch (_e) {
        alternativas = [];
      }

      res.json({
        success: true,
        producto: sanitizeProductForPublic(enriched, isStaff),
        alternativas: alternativas.map((p) => sanitizeProductForPublic(p, isStaff)),
      });
    } catch (err) {
      next(err);
    }
  },

  async getCategorias(req, res, next) {
    try {
      const categorias = await productosRepo.getCategoriasStats();
      res.json({ success: true, categorias });
    } catch (err) {
      next(err);
    }
  },

  async deleteProducto(req, res, next) {
    try {
      const { id } = req.params;
      const parsedId = parseInt(id, 10);
      if (isNaN(parsedId) || parsedId <= 0) {
        return res.status(400).json({ error: 'ID de producto inválido' });
      }

      const deleted = await productosRepo.deleteById(parsedId);
      if (!deleted) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }
      res.json({ success: true, message: `Producto #${parsedId} eliminado` });
    } catch (err) {
      next(err);
    }
  },
};

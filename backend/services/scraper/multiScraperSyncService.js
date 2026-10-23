const crypto = require('crypto');
const db = require('../../config/db');
const logger = require('../../config/logger');
const proveedoresRepo = require('../../repositories/proveedoresScraperRepository');
const pricingCalculator = require('../../utils/pricingCalculator');

let generateEmbeddingsService = null;
try {
  generateEmbeddingsService = require('../embeddings/generateEmbeddings');
} catch (_e) {
  generateEmbeddingsService = null;
}

module.exports = {
  /**
   * Sincroniza un lote de productos extraídos por cualquier scraper hacia la base de datos PostgreSQL.
   * @param {string} proveedorCodigo - Código del proveedor ('equus', 'sitio_2', etc.)
   * @param {Array} rawProducts - Lista de productos crudos
   * @returns {Promise<object>} Estadísticas de sincronización
   */
  async syncProducts(proveedorCodigo, rawProducts = []) {
    if (!proveedorCodigo || !Array.isArray(rawProducts) || rawProducts.length === 0) {
      return { total: 0, inserted: 0, updated: 0, proveedor: proveedorCodigo };
    }

    const proveedor = await proveedoresRepo.getByCodigo(proveedorCodigo);
    if (!proveedor) {
      throw new Error(`Proveedor "${proveedorCodigo}" no configurado en proveedores_scraper`);
    }

    const prefijo = proveedor.prefijo_sku || '';
    const margenPorcentaje = parseFloat(proveedor.margen_porcentaje) || 30.0;
    const costoIncluyeIva = Boolean(proveedor.costo_incluye_iva);
    const aplicarIvaVenta = Boolean(proveedor.aplicar_iva_venta);
    const monedaDefecto = proveedor.moneda_defecto || 'UYU';
    const marcaNombre = proveedor.codigo === 'equus' ? 'Equus' : (proveedor.nombre || proveedorCodigo);

    let inserted = 0;
    let updated = 0;

    for (const raw of rawProducts) {
      const rawSku = (raw.sku || raw.source_id || '').trim();
      if (!rawSku) continue;

      // Normalizar SKU con prefijo del proveedor si no lo tiene
      const finalSku = rawSku.startsWith(prefijo) ? rawSku : `${prefijo}${rawSku}`;
      const nombre = (raw.nombre || raw.name || '').trim();
      if (!nombre) continue;

      // Extraer costo original
      let costo = 0;
      if (typeof raw.costo === 'number') {
        costo = raw.costo;
      } else if (raw.price && typeof raw.price.amount === 'number') {
        costo = raw.price.amount;
      } else if (typeof raw.precio === 'number') {
        costo = raw.precio;
      } else if (raw.precio) {
        costo = parseFloat(raw.precio) || 0;
      }

      // Calcular precio de venta al público aplicando margen e IVA configurados
      const pricing = pricingCalculator.calculateSellingPrice(costo, {
        margenPorcentaje,
        costoIncluyeIva,
        aplicarIvaVenta,
      });

      const precioFinal = pricing.precio_venta;
      const moneda = (raw.moneda || (raw.price && raw.price.currency) || monedaDefecto).toUpperCase();
      const categoria = (raw.categoria || raw.category || 'General').trim();
      const descripcion = (raw.descripcion || raw.description || '').trim();

      // Resolver imagen principal
      let imagenUrl = null;
      if (raw.imagen_url) {
        imagenUrl = raw.imagen_url;
      } else if (Array.isArray(raw.images) && raw.images.length > 0) {
        imagenUrl = raw.images[0];
      }

      const productoUrl = raw.producto_url || raw.product_url || null;
      let stockStatus = 'in_stock';
      if (raw.availability === 'out_of_stock' || raw.inStock === false) {
        stockStatus = 'out_of_stock';
      } else if (raw.availability === 'on_request') {
        stockStatus = 'on_request';
      }

      // Generar hash de contenido para idempotencia
      const hashContent = `${nombre}|${precioFinal}|${costo}|${descripcion}|${stockStatus}`;
      const contenidoHash = crypto.createHash('sha256').update(hashContent).digest('hex');

      const sql = `
        INSERT INTO productos (
          sku, nombre, precio, precio_costo, moneda, marca, categoria, descripcion,
          imagen_url, producto_url, stock_status, discontinuado, fuente_origen,
          margen_aplicado, iva_aplicado, contenido_hash, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, FALSE, $12,
          $13, $14, $15, NOW()
        )
        ON CONFLICT (sku) DO UPDATE SET
          nombre = EXCLUDED.nombre,
          precio = EXCLUDED.precio,
          precio_costo = EXCLUDED.precio_costo,
          moneda = EXCLUDED.moneda,
          marca = EXCLUDED.marca,
          categoria = EXCLUDED.categoria,
          descripcion = EXCLUDED.descripcion,
          imagen_url = EXCLUDED.imagen_url,
          producto_url = EXCLUDED.producto_url,
          stock_status = EXCLUDED.stock_status,
          discontinuado = FALSE,
          fuente_origen = EXCLUDED.fuente_origen,
          margen_aplicado = EXCLUDED.margen_aplicado,
          iva_aplicado = EXCLUDED.iva_aplicado,
          contenido_hash = EXCLUDED.contenido_hash,
          updated_at = NOW()
        RETURNING (xmax = 0) AS is_inserted;
      `;

      const params = [
        finalSku,
        nombre,
        precioFinal,
        costo,
        moneda,
        marcaNombre,
        categoria,
        descripcion,
        imagenUrl,
        productoUrl,
        stockStatus,
        proveedorCodigo,
        pricing.margen_porcentaje,
        pricing.iva_porcentaje,
        contenidoHash,
      ];

      const res = await db.query(sql, params);
      if (res.rows[0]?.is_inserted) {
        inserted++;
      } else {
        updated++;
      }
    }

    logger.info(`[MultiScraperSync] Sincronización finalizada para ${proveedorCodigo}`, {
      proveedor: proveedorCodigo,
      total: rawProducts.length,
      inserted,
      updated,
    });

    // Auto-generación de embeddings vectoriales para búsqueda RAG
    if (generateEmbeddingsService && typeof generateEmbeddingsService.processIncrementalEmbeddings === 'function') {
      try {
        await generateEmbeddingsService.processIncrementalEmbeddings();
      } catch (embErr) {
        logger.warn('[MultiScraperSync] No se pudieron disparar embeddings automáticos', { error: embErr.message });
      }
    }

    return {
      proveedor: proveedorCodigo,
      total: rawProducts.length,
      inserted,
      updated,
    };
  },
};

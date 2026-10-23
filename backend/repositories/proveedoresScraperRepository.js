const db = require('../config/db');
const logger = require('../config/logger');

module.exports = {
  async getAll() {
    try {
      const sql = `
        SELECT p.*,
               COUNT(pr.id) FILTER (WHERE pr.discontinuado = FALSE) AS total_productos_activos,
               COUNT(pr.id) AS total_productos
        FROM proveedores_scraper p
        LEFT JOIN productos pr ON pr.fuente_origen = p.codigo
        GROUP BY p.id
        ORDER BY p.id ASC;
      `;
      const res = await db.query(sql);
      return res.rows;
    } catch (err) {
      logger.error('Error fetching proveedores_scraper', { error: err.message });
      return [];
    }
  },

  async getByCodigo(codigo) {
    if (!codigo) return null;
    try {
      const res = await db.query('SELECT * FROM proveedores_scraper WHERE codigo = $1 LIMIT 1', [codigo]);
      return res.rows[0] || null;
    } catch (err) {
      logger.error('Error fetching proveedor by codigo', { codigo, error: err.message });
      return null;
    }
  },

  async update(codigo, fields = {}) {
    const proveedor = await this.getByCodigo(codigo);
    if (!proveedor) {
      throw new Error(`Proveedor "${codigo}" no encontrado`);
    }

    const {
      nombre,
      activo,
      prefijo_sku,
      margen_porcentaje,
      costo_incluye_iva,
      aplicar_iva_venta,
      moneda_defecto,
      url_base,
      notas,
    } = fields;

    const sql = `
      UPDATE proveedores_scraper
      SET
        nombre = COALESCE($1, nombre),
        activo = COALESCE($2, activo),
        prefijo_sku = COALESCE($3, prefijo_sku),
        margen_porcentaje = COALESCE($4, margen_porcentaje),
        costo_incluye_iva = COALESCE($5, costo_incluye_iva),
        aplicar_iva_venta = COALESCE($6, aplicar_iva_venta),
        moneda_defecto = COALESCE($7, moneda_defecto),
        url_base = COALESCE($8, url_base),
        notas = COALESCE($9, notas),
        updated_at = NOW()
      WHERE codigo = $10
      RETURNING *;
    `;

    const params = [
      nombre !== undefined ? nombre : null,
      activo !== undefined ? activo : null,
      prefijo_sku !== undefined ? prefijo_sku : null,
      margen_porcentaje !== undefined ? parseFloat(margen_porcentaje) : null,
      costo_incluye_iva !== undefined ? Boolean(costo_incluye_iva) : null,
      aplicar_iva_venta !== undefined ? Boolean(aplicar_iva_venta) : null,
      moneda_defecto !== undefined ? moneda_defecto : null,
      url_base !== undefined ? url_base : null,
      notas !== undefined ? notas : null,
      codigo,
    ];

    const res = await db.query(sql, params);
    return res.rows[0];
  },

  async recalcularPrecios(codigo) {
    const proveedor = await this.getByCodigo(codigo);
    if (!proveedor) {
      throw new Error(`Proveedor "${codigo}" no encontrado`);
    }

    const margen = parseFloat(proveedor.margen_porcentaje) || 0;
    const debeAplicarIva = !proveedor.costo_incluye_iva && Boolean(proveedor.aplicar_iva_venta);
    const ivaPorcentaje = debeAplicarIva ? 22.0 : 0.0;

    let updateSql = '';
    if (debeAplicarIva) {
      updateSql = `
        UPDATE productos
        SET precio = ROUND((precio_costo * (1.0 + ($1::numeric / 100.0))) * 1.22, 2),
            margen_aplicado = $1::numeric,
            iva_aplicado = 22.00,
            updated_at = NOW()
        WHERE fuente_origen = $2 AND precio_costo IS NOT NULL AND precio_costo > 0;
      `;
    } else {
      updateSql = `
        UPDATE productos
        SET precio = ROUND(precio_costo * (1.0 + ($1::numeric / 100.0)), 2),
            margen_aplicado = $1::numeric,
            iva_aplicado = 0.00,
            updated_at = NOW()
        WHERE fuente_origen = $2 AND precio_costo IS NOT NULL AND precio_costo > 0;
      `;
    }

    const res = await db.query(updateSql, [margen, codigo]);
    logger.info(`[ProveedoresScraper] Recalculados precios para ${codigo}`, {
      margen,
      ivaAplicado: ivaPorcentaje,
      productosActualizados: res.rowCount,
    });

    return {
      codigo,
      nombre: proveedor.nombre,
      margen_aplicado: margen,
      iva_aplicado: ivaPorcentaje,
      productos_actualizados: res.rowCount,
    };
  },

  async recalcularTodos() {
    const proveedores = await this.getAll();
    const resultados = [];
    for (const p of proveedores) {
      if (p.activo) {
        const res = await this.recalcularPrecios(p.codigo);
        resultados.push(res);
      }
    }
    return resultados;
  },
};

const db = require('../config/db');
const logger = require('../config/logger');

class PromocionesRepository {
  async getAllActive() {
    const query = `
      SELECT pe.id, pe.titulo, pe.subtitulo, pe.badge, pe.descuento_porcentaje,
             pe.link_accion, pe.imagen_url, pe.gradiente, pe.texto_boton, pe.activo,
             pe.orden, pe.productos_skus, pe.created_at, pe.updated_at,
             COUNT(pp.producto_id)::int AS productos_count,
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', p.id,
                   'sku', p.sku,
                   'nombre', p.nombre,
                   'precio', p.precio,
                   'moneda', p.moneda,
                   'imagen_url', p.imagen_url
                 )
               ) FILTER (WHERE p.id IS NOT NULL), '[]'
             ) AS productos
      FROM promociones_especiales pe
      LEFT JOIN promocion_productos pp ON pp.promocion_id = pe.id
      LEFT JOIN productos p ON p.id = pp.producto_id AND p.discontinuado = false
      WHERE pe.activo = true /* WHERE activo = true */
      GROUP BY pe.id
      ORDER BY pe.orden ASC, pe.id DESC
    `;
    const res = await db.query(query);
    return res.rows;
  }

  async getAll() {
    const query = `
      SELECT pe.id, pe.titulo, pe.subtitulo, pe.badge, pe.descuento_porcentaje,
             pe.link_accion, pe.imagen_url, pe.gradiente, pe.texto_boton, pe.activo,
             pe.orden, pe.productos_skus, pe.created_at, pe.updated_at,
             COUNT(pp.producto_id)::int AS productos_count,
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', p.id,
                   'sku', p.sku,
                   'nombre', p.nombre,
                   'precio', p.precio,
                   'moneda', p.moneda,
                   'imagen_url', p.imagen_url
                 )
               ) FILTER (WHERE p.id IS NOT NULL), '[]'
             ) AS productos
      FROM promociones_especiales pe
      LEFT JOIN promocion_productos pp ON pp.promocion_id = pe.id
      LEFT JOIN productos p ON p.id = pp.producto_id AND p.discontinuado = false
      GROUP BY pe.id
      ORDER BY pe.orden ASC, pe.id DESC
    `;
    const res = await db.query(query);
    return res.rows;
  }

  async getById(id) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return null;

    const query = `
      SELECT pe.id, pe.titulo, pe.subtitulo, pe.badge, pe.descuento_porcentaje,
             pe.link_accion, pe.imagen_url, pe.gradiente, pe.texto_boton, pe.activo,
             pe.orden, pe.productos_skus, pe.created_at, pe.updated_at,
             COUNT(pp.producto_id)::int AS productos_count,
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', p.id,
                   'sku', p.sku,
                   'nombre', p.nombre,
                   'precio', p.precio,
                   'moneda', p.moneda,
                   'imagen_url', p.imagen_url
                 )
               ) FILTER (WHERE p.id IS NOT NULL), '[]'
             ) AS productos
      FROM promociones_especiales pe
      LEFT JOIN promocion_productos pp ON pp.promocion_id = pe.id
      LEFT JOIN productos p ON p.id = pp.producto_id AND p.discontinuado = false
      WHERE pe.id = $1
      GROUP BY pe.id
    `;
    const res = await db.query(query, [numId]);
    return res.rows ? (res.rows[0] || null) : null;
  }

  async create(data) {
    const {
      titulo,
      subtitulo = '',
      badge = 'OFERTA ESPECIAL',
      descuento_porcentaje = 0,
      link_accion = '',
      imagen_url = '',
      gradiente = 'amber',
      texto_boton = 'Ver Oferta',
      activo = true,
      orden = 0,
      productos_ids = [],
      productos_skus = [],
    } = data;

    const query = `
      INSERT INTO promociones_especiales (
        titulo, subtitulo, badge, descuento_porcentaje, link_accion,
        imagen_url, gradiente, texto_boton, activo, orden, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *
    `;

    const values = [
      titulo,
      subtitulo,
      badge,
      parseFloat(descuento_porcentaje) || 0,
      link_accion,
      imagen_url,
      gradiente,
      texto_boton,
      activo !== false,
      parseInt(orden, 10) || 0,
    ];

    const res = await db.query(query, values);
    const promo = res.rows ? res.rows[0] : null;
    if (!promo) return null;
    logger.info(`[PromocionesRepo] Promoción creada con ID ${promo.id}`);

    const hasProductsToSync = (Array.isArray(productos_ids) && productos_ids.length > 0) ||
      (Array.isArray(productos_skus) && productos_skus.length > 0) ||
      (typeof productos_skus === 'string' && productos_skus.trim().length > 0);

    if (hasProductsToSync) {
      await this.syncProductos(promo.id, { productos_ids, productos_skus });
      const full = await this.getById(promo.id);
      return full || promo;
    }

    return promo;
  }

  async update(id, data) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return null;

    const current = await this.getById(numId);
    if (!current) return null;

    const titulo = data.titulo !== undefined ? data.titulo : current.titulo;
    const subtitulo = data.subtitulo !== undefined ? data.subtitulo : current.subtitulo;
    const badge = data.badge !== undefined ? data.badge : current.badge;
    const descuento_porcentaje = data.descuento_porcentaje !== undefined
      ? parseFloat(data.descuento_porcentaje) || 0
      : current.descuento_porcentaje;
    const link_accion = data.link_accion !== undefined ? data.link_accion : current.link_accion;
    const imagen_url = data.imagen_url !== undefined ? data.imagen_url : current.imagen_url;
    const gradiente = data.gradiente !== undefined ? data.gradiente : current.gradiente;
    const texto_boton = data.texto_boton !== undefined ? data.texto_boton : current.texto_boton;
    const activo = data.activo !== undefined ? data.activo : current.activo;
    const orden = data.orden !== undefined ? parseInt(data.orden, 10) || 0 : current.orden;

    const query = `
      UPDATE promociones_especiales
      SET titulo = $1,
          subtitulo = $2,
          badge = $3,
          descuento_porcentaje = $4,
          link_accion = $5,
          imagen_url = $6,
          gradiente = $7,
          texto_boton = $8,
          activo = $9,
          orden = $10,
          updated_at = NOW()
      WHERE id = $11
      RETURNING *
    `;

    const values = [
      titulo,
      subtitulo,
      badge,
      descuento_porcentaje,
      link_accion,
      imagen_url,
      gradiente,
      texto_boton,
      activo,
      orden,
      numId,
    ];

    await db.query(query, values);

    if (data.productos_ids !== undefined || data.productos_skus !== undefined) {
      await this.syncProductos(numId, {
        productos_ids: data.productos_ids,
        productos_skus: data.productos_skus,
      });
    }

    return this.getById(numId);
  }

  async syncProductos(promocionId, { productos_ids, productos_skus } = {}) {
    const promoId = parseInt(promocionId, 10);
    if (isNaN(promoId)) return;

    let targetIds = [];

    if (Array.isArray(productos_ids) && productos_ids.length > 0) {
      targetIds = productos_ids.map(Number).filter(n => !isNaN(n) && n > 0);
    } else if (Array.isArray(productos_skus) && productos_skus.length > 0) {
      const cleanSkus = productos_skus.map(s => String(s).trim()).filter(Boolean);
      if (cleanSkus.length > 0) {
        const prodRes = await db.query(
          'SELECT id FROM productos WHERE sku = ANY($1::text[])',
          [cleanSkus]
        );
        targetIds = prodRes.rows.map(r => r.id);
      }
    } else if (typeof productos_skus === 'string' && productos_skus.trim()) {
      const cleanSkus = productos_skus.split(',').map(s => s.trim()).filter(Boolean);
      if (cleanSkus.length > 0) {
        const prodRes = await db.query(
          'SELECT id FROM productos WHERE sku = ANY($1::text[])',
          [cleanSkus]
        );
        targetIds = prodRes.rows.map(r => r.id);
      }
    }

    // 1. Limpiar asignaciones previas
    await db.query('DELETE FROM promocion_productos WHERE promocion_id = $1', [promoId]);

    // 2. Insertar nuevos productos asociados si hay seleccionados
    if (targetIds.length > 0) {
      const valuesSql = targetIds.map((_, idx) => `($1, $${idx + 2})`).join(', ');
      await db.query(
        `INSERT INTO promocion_productos (promocion_id, producto_id) VALUES ${valuesSql} ON CONFLICT DO NOTHING`,
        [promoId, ...targetIds]
      );
    }

    // 3. Mantener array de SKUs actualizado en la tabla principal
    await db.query(`
      UPDATE promociones_especiales pe
      SET productos_skus = COALESCE(
        ARRAY(
          SELECT p.sku 
          FROM promocion_productos pp
          JOIN productos p ON p.id = pp.producto_id
          WHERE pp.promocion_id = pe.id
        ), '{}'
      )
      WHERE pe.id = $1
    `, [promoId]);
  }

  async toggle(id) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return null;

    const query = `
      UPDATE promociones_especiales
      SET activo = NOT activo,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const res = await db.query(query, [numId]);
    return res.rows[0] || null;
  }

  async delete(id) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return null;

    const query = `
      DELETE FROM promociones_especiales
      WHERE id = $1
      RETURNING *
    `;
    const res = await db.query(query, [numId]);
    return res.rows[0] || null;
  }
}

module.exports = new PromocionesRepository();

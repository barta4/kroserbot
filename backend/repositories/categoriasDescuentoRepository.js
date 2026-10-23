const db = require('../config/db');
const logger = require('../config/logger');

const CATEGORIA_COLUMNS = 'id, codigo, nombre, descuento_porcentaje, orden, activo, descripcion, created_at, updated_at';

// Defaults de respaldo en caso de emergencia de base de datos
const STATIC_DEFAULTS = {
  minorista: 0.0,
  profesional: 10.0,
  gremio: 15.0,
  empresa: 20.0,
  mayorista: 25.0,
};

module.exports = {
  async getAll({ soloActivos = false } = {}) {
    try {
      let sql = `SELECT ${CATEGORIA_COLUMNS} FROM categorias_descuento`;
      const params = [];
      if (soloActivos) {
        sql += ' WHERE activo = TRUE';
      }
      sql += ' ORDER BY orden ASC, id ASC';
      const res = await db.query(sql, params);
      return res.rows;
    } catch (err) {
      logger.error('[categoriasDescuentoRepo] Error al obtener categorías', { error: err.message });
      return [];
    }
  },

  async getByCodigo(codigo) {
    if (!codigo || typeof codigo !== 'string') return null;
    const cleanCodigo = codigo.trim().toLowerCase();
    try {
      const sql = `SELECT ${CATEGORIA_COLUMNS} FROM categorias_descuento WHERE lower(codigo) = $1 LIMIT 1;`;
      const res = await db.query(sql, [cleanCodigo]);
      return res.rows[0] || null;
    } catch (err) {
      logger.error('[categoriasDescuentoRepo] Error al buscar categoría por código', { error: err.message, codigo });
      return null;
    }
  },

  async create({
    codigo,
    nombre,
    descuento_porcentaje = 0.0,
    orden = 0,
    activo = true,
    descripcion = null,
  }) {
    if (!codigo || !nombre) {
      throw new Error('El código y el nombre de la categoría son obligatorios');
    }
    const cleanCodigo = String(codigo).trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
    const cleanNombre = String(nombre).trim();
    const pct = Math.max(0, Math.min(100, parseFloat(descuento_porcentaje) || 0));
    const ord = parseInt(orden, 10) || 0;
    const act = activo !== false;

    const sql = `
      INSERT INTO categorias_descuento (
        codigo, nombre, descuento_porcentaje, orden, activo, descripcion
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING ${CATEGORIA_COLUMNS};
    `;

    const res = await db.query(sql, [
      cleanCodigo,
      cleanNombre,
      pct,
      ord,
      act,
      descripcion ? String(descripcion).trim() : null,
    ]);

    return res.rows[0];
  },

  async update(codigo, fields = {}) {
    if (!codigo) return null;
    const cleanCodigo = String(codigo).trim().toLowerCase();

    const allowed = ['nombre', 'descuento_porcentaje', 'orden', 'activo', 'descripcion'];
    const sets = [];
    const params = [];
    let idx = 1;

    for (const key of allowed) {
      if (fields[key] !== undefined) {
        if (key === 'descuento_porcentaje') {
          sets.push(`${key} = $${idx}`);
          params.push(Math.max(0, Math.min(100, parseFloat(fields[key]) || 0)));
        } else if (key === 'orden') {
          sets.push(`${key} = $${idx}`);
          params.push(parseInt(fields[key], 10) || 0);
        } else if (key === 'activo') {
          sets.push(`${key} = $${idx}`);
          params.push(Boolean(fields[key]));
        } else {
          sets.push(`${key} = $${idx}`);
          params.push(fields[key]);
        }
        idx++;
      }
    }

    if (sets.length === 0) {
      return this.getByCodigo(cleanCodigo);
    }

    sets.push(`updated_at = NOW()`);
    params.push(cleanCodigo);

    const sql = `
      UPDATE categorias_descuento
      SET ${sets.join(', ')}
      WHERE lower(codigo) = $${idx}
      RETURNING ${CATEGORIA_COLUMNS};
    `;

    const res = await db.query(sql, params);
    return res.rows[0] || null;
  },

  async delete(codigo) {
    if (!codigo) return false;
    const cleanCodigo = String(codigo).trim().toLowerCase();

    // Verificamos si hay clientes usando esta categoría
    const countRes = await db.query('SELECT COUNT(*) as total FROM clientes_usuarios WHERE lower(categoria) = $1', [cleanCodigo]);
    const clientesCount = parseInt(countRes.rows[0]?.total || 0, 10);

    if (clientesCount > 0) {
      // Si hay clientes asignados, no borramos físicamente para evitar inconsistencias; se desactiva
      await db.query('UPDATE categorias_descuento SET activo = FALSE, updated_at = NOW() WHERE lower(codigo) = $1', [cleanCodigo]);
      return { deleted: false, deactivated: true, message: `La categoría tiene ${clientesCount} clientes asociados. Fue desactivada en lugar de eliminarse.` };
    }

    const res = await db.query('DELETE FROM categorias_descuento WHERE lower(codigo) = $1 RETURNING id', [cleanCodigo]);
    return { deleted: res.rowCount > 0, deactivated: false };
  },

  async getDiscountsMap() {
    try {
      const sql = 'SELECT codigo, descuento_porcentaje FROM categorias_descuento WHERE activo = TRUE';
      const res = await db.query(sql);
      const map = { ...STATIC_DEFAULTS };
      for (const row of res.rows) {
        map[row.codigo.toLowerCase()] = parseFloat(row.descuento_porcentaje) || 0.0;
      }
      return map;
    } catch (err) {
      logger.error('[categoriasDescuentoRepo] Error al construir mapa de descuentos', { error: err.message });
      return { ...STATIC_DEFAULTS };
    }
  },
};

const db = require('../config/db');
const logger = require('../config/logger');

const CLIENTE_COLUMNS = 'id, email, nombre, empresa_razon_social, rut_ci, telefono, categoria, descuento_porcentaje, activo, created_at, updated_at';

module.exports = {
  async findByEmail(email) {
    if (!email || typeof email !== 'string') return null;
    const cleanEmail = email.trim().toLowerCase();
    try {
      const sql = `SELECT ${CLIENTE_COLUMNS}, password_hash FROM clientes_usuarios WHERE lower(email) = $1 LIMIT 1;`;
      const res = await db.query(sql, [cleanEmail]);
      return res.rows[0] || null;
    } catch (err) {
      logger.error('[clientesRepo] Error al buscar por email', { error: err.message, email: cleanEmail });
      return null;
    }
  },

  async findById(id) {
    const numId = parseInt(id, 10);
    if (isNaN(numId) || numId <= 0) return null;
    try {
      const sql = `SELECT ${CLIENTE_COLUMNS} FROM clientes_usuarios WHERE id = $1 LIMIT 1;`;
      const res = await db.query(sql, [numId]);
      return res.rows[0] || null;
    } catch (err) {
      logger.error('[clientesRepo] Error al buscar por id', { error: err.message, id: numId });
      return null;
    }
  },

  async create({
    email,
    passwordHash,
    nombre,
    empresa_razon_social = null,
    rut_ci = null,
    telefono = null,
    categoria = 'minorista',
    descuento_porcentaje = 0.0,
  }) {
    const cleanEmail = email.trim().toLowerCase();
    const cleanNombre = nombre.trim();
    const cleanCategoria = (categoria || 'minorista').toLowerCase();
    const numDescuento = Math.max(0, Math.min(100, parseFloat(descuento_porcentaje) || 0));

    const sql = `
      INSERT INTO clientes_usuarios (
        email, password_hash, nombre, empresa_razon_social, rut_ci, telefono, categoria, descuento_porcentaje
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING ${CLIENTE_COLUMNS};
    `;

    const params = [
      cleanEmail,
      passwordHash,
      cleanNombre,
      empresa_razon_social || null,
      rut_ci || null,
      telefono || null,
      cleanCategoria,
      numDescuento,
    ];

    const res = await db.query(sql, params);
    return res.rows[0];
  },

  async update(id, fields = {}) {
    const numId = parseInt(id, 10);
    if (isNaN(numId) || numId <= 0) return null;

    const allowed = ['nombre', 'empresa_razon_social', 'rut_ci', 'telefono', 'categoria', 'descuento_porcentaje', 'activo'];
    const sets = [];
    const params = [];
    let idx = 1;

    for (const key of allowed) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = $${idx}`);
        params.push(fields[key]);
        idx++;
      }
    }

    if (fields.passwordHash) {
      sets.push(`password_hash = $${idx}`);
      params.push(fields.passwordHash);
      idx++;
    }

    if (sets.length === 0) {
      return this.findById(numId);
    }

    sets.push(`updated_at = NOW()`);
    params.push(numId);

    const sql = `
      UPDATE clientes_usuarios
      SET ${sets.join(', ')}
      WHERE id = $${idx}
      RETURNING ${CLIENTE_COLUMNS};
    `;

    const res = await db.query(sql, params);
    return res.rows[0] || null;
  },

  async list({ search, categoria, limit = 50, offset = 0 } = {}) {
    try {
      const parsedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
      const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

      let countSql = 'SELECT COUNT(*) as total FROM clientes_usuarios WHERE 1=1';
      let sql = `SELECT ${CLIENTE_COLUMNS} FROM clientes_usuarios WHERE 1=1`;
      const params = [];

      if (search && typeof search === 'string' && search.trim() !== '') {
        params.push(`%${search.trim()}%`);
        const clause = ` AND (nombre ILIKE $${params.length} OR email ILIKE $${params.length} OR empresa_razon_social ILIKE $${params.length} OR rut_ci ILIKE $${params.length})`;
        countSql += clause;
        sql += clause;
      }

      if (categoria && typeof categoria === 'string' && categoria.trim() !== '') {
        params.push(categoria.trim().toLowerCase());
        const clause = ` AND categoria = $${params.length}`;
        countSql += clause;
        sql += clause;
      }

      const countRes = await db.query(countSql, params);
      const total = parseInt(countRes.rows[0]?.total || 0, 10);

      sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      const listParams = [...params, parsedLimit, parsedOffset];

      const res = await db.query(sql, listParams);
      return {
        items: res.rows,
        total,
        limit: parsedLimit,
        offset: parsedOffset,
      };
    } catch (err) {
      logger.error('[clientesRepo] Error al listar clientes', { error: err.message });
      return { items: [], total: 0, limit, offset };
    }
  },
};

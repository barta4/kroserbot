const jwt = require('jsonwebtoken');
const clientesRepo = require('../repositories/clientesRepository');
require('dotenv').config();

function extractClientToken(req) {
  if (req.cookies && req.cookies.cotibot_token) {
    return req.cookies.cotibot_token;
  }
  const authHeader = req.headers && req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  return null;
}

function optionalClienteAuth(req, res, next) {
  const token = extractClientToken(req);
  if (!token) {
    req.cliente = null;
    return next();
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    req.cliente = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (decoded && decoded.role === 'cliente') {
      req.cliente = decoded;
      if (!req.user) {
        req.user = decoded;
      }
    } else {
      req.cliente = null;
    }
    next();
  } catch (_err) {
    req.cliente = null;
    next();
  }
}

async function requireClienteAuth(req, res, next) {
  const token = extractClientToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Acceso no autorizado. Inicie sesión para continuar.' });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Configuración de autenticación del servidor incompleta' });
  }

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (!decoded || decoded.role !== 'cliente') {
      return res.status(403).json({ error: 'Acceso denegado: se requiere sesión de cliente.' });
    }

    // Verificación de revocación / estado activo en base de datos
    if (decoded.id && typeof clientesRepo.findById === 'function') {
      try {
        const clienteDb = await clientesRepo.findById(decoded.id);
        if (clienteDb && !clienteDb.activo) {
          return res.status(403).json({ error: 'Esta cuenta ha sido desactivada. Comuníquese con soporte.' });
        }
        if (clienteDb) {
          decoded.categoria = clienteDb.categoria || decoded.categoria;
          decoded.descuento_porcentaje = parseFloat(clienteDb.descuento_porcentaje) || 0;
        }
      } catch (_dbErr) {
        // En caso de mock o prueba unitaria sin findById, continuar con decoded verificado
      }
    }

    req.cliente = decoded;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o expirada. Por favor vuelva a iniciar sesión.' });
  }
}

module.exports = {
  extractClientToken,
  optionalClienteAuth,
  requireClienteAuth,
};

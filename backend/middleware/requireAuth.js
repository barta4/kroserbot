const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

function extractToken(req) {
  if (req.cookies && req.cookies.kroser_token) {
    return req.cookies.kroser_token;
  }
  const authHeader = req.headers && req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  return null;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado. Token requerido.' });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Configuración de autenticación del servidor incompleta' });
  }

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    // Seguridad (H5): Denegar tokens de clientes en rutas administrativas o de depósito
    if (!decoded || decoded.role === 'cliente' || (decoded.role !== 'admin' && decoded.role !== 'deposito')) {
      return res.status(403).json({ error: 'Acceso denegado: se requieren credenciales de personal administrativo.' });
    }
    req.user = { username: decoded.username, role: decoded.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      if (!req.user || !allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          error: `Acceso prohibido. Se requiere rol: ${allowedRoles.join(' o ')}`,
        });
      }
      next();
    });
  };
}

module.exports = { requireAuth, requireRole };

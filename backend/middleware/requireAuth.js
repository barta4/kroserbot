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

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
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

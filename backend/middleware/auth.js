require('dotenv').config();

module.exports = function basicAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const expectedAuth = process.env.WEBHOOK_BASIC_AUTH;

  // If no WEBHOOK_BASIC_AUTH configured in env, allow in dev
  if (!expectedAuth) {
    return next();
  }

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Acceso no autorizado: credenciales faltantes' });
  }

  const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString('ascii');
  if (credentials !== expectedAuth) {
    return res.status(401).json({ error: 'Acceso no autorizado: credenciales inválidas' });
  }

  next();
};

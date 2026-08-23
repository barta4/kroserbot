require('dotenv').config();

const EXPECTED_AUTH = process.env.WEBHOOK_BASIC_AUTH;

if (!EXPECTED_AUTH || String(EXPECTED_AUTH).trim() === '') {
  console.error('[FATAL] Falta variable de entorno WEBHOOK_BASIC_AUTH');
  if (require.main === module) {
    process.exit(1);
  }
}

module.exports = function basicAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Acceso no autorizado: credenciales faltantes' });
  }

  const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString('ascii');
  if (credentials !== EXPECTED_AUTH) {
    return res.status(401).json({ error: 'Acceso no autorizado: credenciales inválidas' });
  }

  next();
};

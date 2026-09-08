const crypto = require('crypto');
require('dotenv').config();

const INITIAL_EXPECTED = process.env.WEBHOOK_BASIC_AUTH;
if (!INITIAL_EXPECTED || String(INITIAL_EXPECTED).trim() === '') {
  console.error('[FATAL] Falta variable de entorno WEBHOOK_BASIC_AUTH');
}

module.exports = function basicAuth(req, res, next) {
  const expectedAuth = process.env.WEBHOOK_BASIC_AUTH;

  if (!expectedAuth || String(expectedAuth).trim() === '') {
    console.error('[auth] Petición rechazada: variable WEBHOOK_BASIC_AUTH no está configurada.');
    return res.status(500).json({ error: 'Configuración de autenticación del servidor incompleta' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Acceso no autorizado: credenciales faltantes' });
  }

  const base64Part = authHeader.split(' ')[1] || '';
  if (!base64Part.trim()) {
    return res.status(401).json({ error: 'Acceso no autorizado: credenciales inválidas' });
  }

  const credentials = Buffer.from(base64Part, 'base64').toString('ascii');
  if (!credentials) {
    return res.status(401).json({ error: 'Acceso no autorizado: credenciales inválidas' });
  }

  const credBuf = Buffer.from(credentials, 'utf8');
  const expBuf = Buffer.from(expectedAuth, 'utf8');

  if (credBuf.length === 0 || expBuf.length === 0 || credBuf.length !== expBuf.length || !crypto.timingSafeEqual(credBuf, expBuf)) {
    return res.status(401).json({ error: 'Acceso no autorizado: credenciales inválidas' });
  }

  next();
};

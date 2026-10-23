const crypto = require('crypto');
const logger = require('../config/logger');
require('dotenv').config();

const INITIAL_EXPECTED = process.env.WEBHOOK_BASIC_AUTH;
if (!INITIAL_EXPECTED || String(INITIAL_EXPECTED).trim() === '') {
  logger.error('[FATAL] Falta variable de entorno WEBHOOK_BASIC_AUTH');
}

module.exports = function basicAuth(req, res, next) {
  const expectedAuth = process.env.WEBHOOK_BASIC_AUTH;

  if (!expectedAuth || String(expectedAuth).trim() === '') {
    logger.error('[auth] Petición rechazada: variable WEBHOOK_BASIC_AUTH no está configurada.');
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

  const credentials = Buffer.from(base64Part, 'base64').toString('utf8');
  if (!credentials) {
    return res.status(401).json({ error: 'Acceso no autorizado: credenciales inválidas' });
  }

  // Comparación blindada en tiempo constante (ambos hashes tienen exactamente 32 bytes)
  const hashCred = crypto.createHash('sha256').update(credentials, 'utf8').digest();
  const hashExp = crypto.createHash('sha256').update(expectedAuth, 'utf8').digest();

  if (!crypto.timingSafeEqual(hashCred, hashExp)) {
    return res.status(401).json({ error: 'Acceso no autorizado: credenciales inválidas' });
  }

  next();
};

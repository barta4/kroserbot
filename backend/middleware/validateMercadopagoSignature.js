/**
 * validateMercadopagoSignature.js
 * 
 * Middleware que valida la firma digital (HMAC-SHA256) enviada por MercadoPago
 * en el encabezado 'x-signature' para garantizar la autenticidad del webhook.
 */

const crypto = require('crypto');
const configuracionRepo = require('../repositories/configuracionRepository');

module.exports = async function validateMercadopagoSignature(req, res, next) {
  const secret =
    (await configuracionRepo.get('mercadopago_webhook_secret')) ||
    process.env.MERCADOPAGO_WEBHOOK_SECRET;

  if (!secret || String(secret).trim() === '') {
    console.error('[MercadoPago Security] Rejection: MERCADOPAGO_WEBHOOK_SECRET not set');
    return res.status(503).json({ error: 'Webhook de MercadoPago no configurado en servidor.' });
  }

  const signature = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];

  if (!signature) {
    console.warn('[MercadoPago Security Warning] Missing x-signature header');
    return res.status(401).json({ error: 'Acceso denegado: falta encabezado x-signature' });
  }

  try {
    const parts = {};
    signature.split(',').forEach((part) => {
      const [key, val] = part.split('=');
      if (key && val) {
        parts[key.trim()] = val.trim();
      }
    });

    const ts = parts.ts;
    const v1 = parts.v1;

    if (!ts || !v1) {
      console.warn('[MercadoPago Security Warning] Malformed x-signature header');
      return res.status(401).json({ error: 'Acceso denegado: formato de firma inválido' });
    }

    // Check timestamp to avoid replay attacks (5 minute window)
    const currentTs = Math.floor(Date.now() / 1000);
    const requestTs = parseInt(ts, 10);
    if (isNaN(requestTs) || Math.abs(currentTs - requestTs) > 300) {
      console.warn(`[MercadoPago Security Warning] Expired signature timestamp: ${ts}`);
      return res.status(401).json({ error: 'Acceso denegado: timestamp expirado o inválido' });
    }

    const dataId = req.body?.data?.id || req.query?.['data.id'] || '';
    const manifest = `id:${dataId};request-id:${requestId || ''};ts:${ts};`;
    const computedHmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

    if (computedHmac !== v1) {
      console.error('[MercadoPago Security Error] Invalid signature match');
      return res.status(401).json({ error: 'Acceso denegado: firma inválida' });
    }

    // Signature verified
    next();
  } catch (err) {
    console.error('[MercadoPago Security Error] Signature verification exception:', err.message);
    return res.status(401).json({ error: 'Error al verificar firma de seguridad' });
  }
};

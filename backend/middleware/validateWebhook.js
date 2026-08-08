module.exports = function validateWebhook(req, res, next) {
  const payload = req.body;

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Payload malformado' });
  }

  // Allow valid Chatwoot event objects or simple test payloads
  if (!payload.event && !payload.message && !payload.content) {
    return res.status(400).json({ error: 'Payload de webhook inválido: falta campo event o message' });
  }

  next();
};

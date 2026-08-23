const { webhookPayloadSchema } = require('../schemas');
const { validate } = require('../schemas/validate');

module.exports = function validateWebhook(req, res, next) {
  const result = validate(webhookPayloadSchema, req.body);
  if (!result.valid) {
    return res.status(400).json({ error: 'Payload de webhook inválido', details: result.errors });
  }
  req.body = result.data;
  next();
};

/**
 * Claves de configuración consideradas sensibles o secretas.
 * Se utilizan para cifrado en base de datos (AES-256-GCM) y para enmascarado en la API.
 */
const SECRET_KEYS = new Set([
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'llm_api_key',
  'llm_fallback_api_key',
  'chatwoot_api_token',
  'chatwoot_base_url',
  'mercadopago_access_token',
  'mercadopago_public_key',
  'mercadopago_webhook_secret',
  'SMTP_PASS',
  'smtp_pass',
  'sql_directo_url',
  'api_productos_key',
]);

module.exports = SECRET_KEYS;

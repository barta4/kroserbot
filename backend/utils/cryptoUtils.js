const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

function getEncryptionKey() {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'kroserbot_default_secure_key_2026';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Cifra un texto usando AES-256-GCM.
 * @param {string} text - Texto en plano a cifrar.
 * @returns {string} - Cadena cifrada con prefijo enc:v1:<iv>:<tag>:<ciphertext>
 */
function encrypt(text) {
  if (text === null || text === undefined || typeof text !== 'string') {
    return text;
  }
  if (text.startsWith(PREFIX)) {
    return text; // Ya está cifrado
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return `${PREFIX}${iv.toString('hex')}:${tag}:${encrypted}`;
}

/**
 * Descifra una cadena cifrada con AES-256-GCM.
 * Si no está cifrada (texto plano legado), devuelve el texto original sin error.
 * @param {string} text - Cadena a descifrar.
 * @returns {string} - Texto descifrado o el texto original.
 */
function decrypt(text) {
  if (text === null || text === undefined || typeof text !== 'string') {
    return text;
  }
  if (!text.startsWith(PREFIX)) {
    return text; // Texto plano no cifrado (compatibilidad retroactiva)
  }

  try {
    const parts = text.slice(PREFIX.length).split(':');
    if (parts.length !== 3) {
      return text;
    }

    const [ivHex, tagHex, encryptedHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.warn('[cryptoUtils] Falló el descifrado, devolviendo texto original:', err.message);
    return text;
  }
}

module.exports = {
  encrypt,
  decrypt,
};

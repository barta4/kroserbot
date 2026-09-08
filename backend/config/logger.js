const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '../../logs');
let canWriteLogs = true;
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (err) {
  canWriteLogs = false;
  console.warn('[Logger] No se pudo inicializar directorio de logs local:', err.message);
}

function maskPII(text) {
  if (typeof text !== 'string') return text;

  let masked = text;

  // 1. Mask Credit Cards (13 to 16 digits)
  masked = masked.replace(/\b(?:\d[ -]*?){13,16}\b/g, '[TARJETA ENMASCARADA]');

  // 2. Mask Emails
  masked = masked.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL ENMASCARADO]');

  // 3. Mask Uruguayan phone numbers (BEFORE unformatted CI to prevent shadowing)
  // Celulares: 09XXXXXXXX
  masked = masked.replace(/\b09\d{7}\b/g, '[TEL ENMASCARADO]');
  // Fijos de Montevideo e Interior (8 dígitos iniciando con 2): 2XXXXXXX
  masked = masked.replace(/\b2\d{7}\b/g, '[TEL ENMASCARADO]');
  // Con prefijo internacional +598
  masked = masked.replace(/\+598\s?9\d{7,8}\b/g, '[TEL ENMASCARADO]');
  masked = masked.replace(/\+598\s?2\d{7}\b/g, '[TEL ENMASCARADO]');

  // 4. Mask CI (Uruguayan ID) with dots and hyphen format: X.XXX.XXX-X
  masked = masked.replace(/\b\d{1}\.\d{3}\.\d{3}-\d{1}\b/g, '[CI ENMASCARADA]');

  // 5. Mask unformatted CI (valid range in Uruguay is typically 1.000.000 to 6.500.000, 7-8 digits not starting with 09 or 2)
  masked = masked.replace(/\b([1-6]\d{6,7})\b/g, (match) => {
    return '[CI ENMASCARADA]';
  });

  return masked;
}

function writeLog(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  let logStr = '';
  
  if (typeof message === 'object') {
    logStr = JSON.stringify(message);
  } else {
    logStr = String(message);
  }

  logStr = maskPII(logStr);

  const logEntry = {
    timestamp,
    level,
    message: logStr,
    ...meta
  };

  const jsonLog = JSON.stringify(logEntry);
  
  // Print to console (always)
  if (level === 'error') {
    console.error(jsonLog);
  } else if (level === 'warn') {
    console.warn(jsonLog);
  } else {
    console.log(jsonLog);
  }

  // Write to file if filesystem permits
  if (canWriteLogs) {
    const today = new Date().toISOString().split('T')[0];
    const file = path.join(logDir, `kroserbot-${today}.log`);
    fs.appendFile(file, jsonLog + '\n', (err) => {
      if (err) console.error('Failed to write log file', err);
    });
  }
}

module.exports = {
  info: (msg, meta) => writeLog('info', msg, meta),
  warn: (msg, meta) => writeLog('warn', msg, meta),
  error: (msg, meta) => writeLog('error', msg, meta),
  debug: (msg, meta) => writeLog('debug', msg, meta),
};

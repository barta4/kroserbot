const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

function maskPII(text) {
  if (typeof text !== 'string') return text;

  // Mask CI (Uruguayan ID) - formats: X.XXX.XXX-X or XXXXXXXX
  let masked = text.replace(/\b\d{1}\.\d{3}\.\d{3}-\d{1}\b/g, '[CI ENMASCARADA]');
  masked = masked.replace(/\b\d{7,8}\b/g, (match) => {
    if (match.startsWith('09')) return match;
    return '[CI ENMASCARADA]';
  });

  // Mask Credit Cards
  masked = masked.replace(/\b(?:\d[ -]*?){13,16}\b/g, '[TARJETA ENMASCARADA]');

  // Mask Emails
  masked = masked.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL ENMASCARADO]');

  // Mask Uruguayan phone numbers: 09XXXXXXXX, +598 9X XXX XXX, 2XXXXXXX
  masked = masked.replace(/\b09\d{7}\b/g, '[TEL ENMASCARADO]');
  masked = masked.replace(/\+598\s?9\d{7,8}\b/g, '[TEL ENMASCARADO]');
  masked = masked.replace(/\+598\s?2\d{7}\b/g, '[TEL ENMASCARADO]');
  masked = masked.replace(/\b2\d{7}\b/g, (match) => {
    if (match.length === 8) return '[TEL ENMASCARADO]';
    return match;
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

  // Write to file
  const today = new Date().toISOString().split('T')[0];
  const file = path.join(logDir, `kroserbot-${today}.log`);
  fs.appendFile(file, jsonLog + '\n', (err) => {
    if (err) console.error('Failed to write log file', err);
  });
}

module.exports = {
  info: (msg, meta) => writeLog('info', msg, meta),
  warn: (msg, meta) => writeLog('warn', msg, meta),
  error: (msg, meta) => writeLog('error', msg, meta),
  debug: (msg, meta) => writeLog('debug', msg, meta),
};

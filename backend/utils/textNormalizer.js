/**
 * Normaliza un texto para búsqueda de patrones sin diacríticos, puntuación ni espacios redundantes.
 * @param {string} str - Texto a normalizar.
 * @returns {string} - Texto normalizado en minúsculas sin acentos ni caracteres especiales.
 */
function normalize(str = '') {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  normalize,
};

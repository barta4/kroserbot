/**
 * Formatea el precio de un producto según su moneda (UYU o USD), considerando precios de oferta.
 * @param {object} p - Producto con propiedades precio, precio_oferta y moneda.
 * @returns {string} - Cadena de precio formateada (ej. "$ 590 UYU" o "U$S 45").
 */
function formatCurrencyPrice(p) {
  if (!p) return '';
  const isUyu = (p.moneda || '').toUpperCase() === 'UYU' || (parseFloat(p.precio) >= 200 && (p.moneda || '').toUpperCase() !== 'USD');
  const symbol = isUyu ? '$' : 'U$S';
  const suffix = isUyu ? ' UYU' : '';
  if (p.precio_oferta) {
    return `${symbol} ${p.precio_oferta}${suffix} (Oferta, Normal: ${symbol} ${p.precio}${suffix})`;
  }
  return `${symbol} ${p.precio}${suffix}`;
}

module.exports = {
  formatCurrencyPrice,
};

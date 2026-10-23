/**
 * Motor de Precios y Descuentos para Cotibot
 * Permite calcular precios personalizados según la categoría o porcentaje del cliente.
 */

const CATEGORY_DEFAULT_DISCOUNTS = {
  minorista: 0.0,
  profesional: 10.0,
  gremio: 15.0,
  empresa: 20.0,
  mayorista: 25.0,
};

let dynamicCategoryDiscounts = null;

function setDynamicCategoryDiscounts(map) {
  if (map && typeof map === 'object') {
    dynamicCategoryDiscounts = { ...map };
  }
}

/**
 * Obtiene el porcentaje de descuento efectivo para un cliente dado.
 * @param {object|null} cliente - Objeto de cliente con categoria y descuento_porcentaje opcional.
 * @param {object|null} customCategoryDiscounts - Mapa opcional de descuentos por categoría.
 * @returns {number} - Porcentaje de descuento entre 0 y 100.
 */
function getEffectiveDiscount(cliente, customCategoryDiscounts = null) {
  if (!cliente) return 0;
  if (typeof cliente.descuento_porcentaje === 'number' && cliente.descuento_porcentaje > 0) {
    return Math.max(0, Math.min(100, cliente.descuento_porcentaje));
  }
  const cat = (cliente.categoria || 'minorista').toLowerCase();
  if (customCategoryDiscounts && customCategoryDiscounts[cat] !== undefined) {
    return parseFloat(customCategoryDiscounts[cat]) || 0.0;
  }
  if (dynamicCategoryDiscounts && dynamicCategoryDiscounts[cat] !== undefined) {
    return parseFloat(dynamicCategoryDiscounts[cat]) || 0.0;
  }
  return CATEGORY_DEFAULT_DISCOUNTS[cat] || 0.0;
}

/**
 * Calcula el precio bonificado para un producto.
 * @param {object} producto - Objeto del producto con precio, precio_oferta, moneda.
 * @param {object|null} cliente - Objeto de cliente o null si es visitante anónimo.
 * @returns {object} - Objeto enriquecido con precio_original, precio_final, descuento_porcentaje, ahorro.
 */
function calculateProductPrice(producto, cliente = null) {
  if (!producto) return null;

  const precioLista = parseFloat(producto.precio) || 0;
  const precioOferta = producto.precio_oferta ? parseFloat(producto.precio_oferta) : null;
  const moneda = (producto.moneda || 'UYU').toUpperCase();
  const symbol = moneda === 'USD' ? 'U$S' : '$';

  const discountPct = getEffectiveDiscount(cliente);
  const promoPct = producto.promo_descuento ? parseFloat(producto.promo_descuento) : 0;

  // Si tiene promoción activa configurada por el admin
  if (promoPct > 0 && promoPct >= discountPct) {
    const promoPrice = Math.round(precioLista * (1 - promoPct / 100) * 100) / 100;
    const finalPrice = precioOferta && precioOferta > 0 && precioOferta < promoPrice ? precioOferta : promoPrice;
    const ahorro = Math.max(0, precioLista - finalPrice);
    return {
      ...producto,
      precio_lista: precioLista,
      precio_final: finalPrice,
      descuento_porcentaje: promoPct,
      ahorro_monto: Math.round(ahorro * 100) / 100,
      motivo_descuento: producto.promo_badge ? `Promo: ${producto.promo_badge}` : `Promoción Especial (${promoPct}%)`,
      es_promocion: true,
      es_oferta_publica: true,
      precio_formateado: `${symbol} ${finalPrice}`,
    };
  }

  // Si no hay cliente o no tiene descuento, se respeta precio de oferta o precio de lista
  if (!cliente || discountPct === 0) {
    const finalPrice = precioOferta && precioOferta > 0 ? precioOferta : precioLista;
    const ahorro = Math.max(0, precioLista - finalPrice);
    return {
      ...producto,
      precio_lista: precioLista,
      precio_final: finalPrice,
      descuento_porcentaje: 0,
      ahorro_monto: Math.round(ahorro * 100) / 100,
      es_oferta_publica: Boolean(precioOferta && precioOferta < precioLista),
      precio_formateado: `${symbol} ${finalPrice}`,
    };
  }

  // Si tiene descuento por categoría o personalizado:
  // Se aplica sobre el precio de lista normal
  const calculatedDiscountPrice = Math.round(precioLista * (1 - discountPct / 100) * 100) / 100;

  // Si el precio de oferta pública fuera aún menor que el descuento del cliente,
  // el cliente siempre se beneficia del menor precio posible.
  let finalPrice = calculatedDiscountPrice;
  let motivoDescuento = `Descuento ${cliente.categoria || 'Cliente'} (${discountPct}%)`;

  if (precioOferta && precioOferta > 0 && precioOferta < calculatedDiscountPrice) {
    finalPrice = precioOferta;
    motivoDescuento = 'Mejor oferta pública aplicada';
  }

  const ahorro = Math.max(0, precioLista - finalPrice);

  return {
    ...producto,
    precio_lista: precioLista,
    precio_final: finalPrice,
    descuento_porcentaje: discountPct,
    ahorro_monto: Math.round(ahorro * 100) / 100,
    motivo_descuento: motivoDescuento,
    categoria_cliente: cliente.categoria || 'minorista',
    precio_formateado: `${symbol} ${finalPrice}`,
  };
}

/**
 * Calcula el precio de venta final a partir del costo mayorista según las reglas de margen e IVA del proveedor.
 * @param {number} costo - Precio de costo mayorista.
 * @param {object} opciones - { margenPorcentaje, costoIncluyeIva, aplicarIvaVenta }
 * @returns {object} { precio_costo, precio_venta, subtotal, precio_neto, iva_monto, margen_porcentaje, iva_porcentaje }
 */
function calculateSellingPrice(costo, { margenPorcentaje = 30.0, costoIncluyeIva = true, aplicarIvaVenta = false } = {}) {
  const numericCosto = parseFloat(costo) || 0;
  if (numericCosto <= 0) {
    return {
      precio_costo: 0,
      precio_venta: 0,
      precio_neto: 0,
      subtotal: 0,
      iva_monto: 0,
      margen_porcentaje: parseFloat(margenPorcentaje) || 0,
      iva_porcentaje: 0,
    };
  }

  const margen = Math.max(0, parseFloat(margenPorcentaje) || 0);
  const factorMargen = 1 + (margen / 100);
  const subtotalConMargen = numericCosto * factorMargen;

  // Si el costo NO incluye IVA y se debe aplicar IVA a la venta (IVA 22% UY)
  const debeAplicarIva = !costoIncluyeIva && Boolean(aplicarIvaVenta);
  const ivaPorcentaje = debeAplicarIva ? 22.0 : 0.0;
  const precioVenta = debeAplicarIva ? subtotalConMargen * 1.22 : subtotalConMargen;
  const ivaMonto = debeAplicarIva ? (precioVenta - subtotalConMargen) : 0;

  return {
    precio_costo: Math.round(numericCosto * 100) / 100,
    subtotal: Math.round(subtotalConMargen * 100) / 100,
    precio_neto: Math.round(subtotalConMargen * 100) / 100,
    iva_monto: Math.round(ivaMonto * 100) / 100,
    precio_venta: Math.round(precioVenta * 100) / 100,
    margen_porcentaje: margen,
    iva_porcentaje: ivaPorcentaje,
  };
}

/**
 * Enriquecer una lista de productos con precios calculados según el cliente.
 * @param {Array} productos - Lista de productos.
 * @param {object|null} cliente - Cliente logueado o null.
 * @returns {Array} - Lista de productos con precios calculados.
 */
function enrichProductsWithPricing(productos = [], cliente = null) {
  if (!Array.isArray(productos)) return [];
  return productos.map((p) => calculateProductPrice(p, cliente));
}

module.exports = {
  CATEGORY_DEFAULT_DISCOUNTS,
  setDynamicCategoryDiscounts,
  getEffectiveDiscount,
  calculateProductPrice,
  calculateSellingPrice,
  enrichProductsWithPricing,
};


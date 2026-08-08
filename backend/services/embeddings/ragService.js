const productosRepo = require('../../repositories/productosRepository');
const localesRepo = require('../../repositories/localesRepository');

module.exports = {
  async getRelevantContext(queryText) {
    let productos = [];
    let locales = [];

    try {
      // Search products using keyword matching fallback or vector search
      productos = await productosRepo.searchByKeyword(queryText, 5);

      // Search stores if store/location related terms in query
      const lowerQ = queryText.toLowerCase();
      if (
        lowerQ.includes('local') ||
        lowerQ.includes('sucursal') ||
        lowerQ.includes('horario') ||
        lowerQ.includes('direccion') ||
        lowerQ.includes('donde') ||
        lowerQ.includes('abierto')
      ) {
        locales = await localesRepo.getAll();
      }
    } catch (err) {
      console.warn(`[RAG Search Error] ${err.message}`);
    }

    // Format context for system prompt
    let contextStr = '';

    if (productos.length > 0) {
      contextStr += 'PRODUCTOS RELEVANTES ENCONTRADOS EN CATÁLOGO:\n';
      productos.forEach((p) => {
        const precioText = p.precio_oferta ? `$${p.precio_oferta} (Oferta, Normal: $${p.precio})` : `$${p.precio}`;
        contextStr += `- SKU: ${p.sku} | ${p.nombre} | Marca: ${p.marca || 'N/A'} | Precio: ${precioText} | Stock: ${p.stock_status}\n`;
        if (p.descripcion) contextStr += `  Descripción: ${p.descripcion.substring(0, 150)}...\n`;
      });
      contextStr += '\n';
    }

    if (locales.length > 0) {
      contextStr += 'SUCURSALES Y LOCALES KROSER:\n';
      locales.forEach((l) => {
        contextStr += `- ${l.nombre} (${l.zona}): ${l.direccion} | Tel: ${l.telefono} | Horario: ${l.horario}\n`;
      });
      contextStr += '\n';
    }

    return {
      contextStr,
      productosEncontrados: productos,
      localesEncontrados: locales,
    };
  },
};

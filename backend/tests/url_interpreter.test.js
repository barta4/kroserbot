const urlInterpreterService = require('../services/media/urlInterpreterService');
const axios = require('axios');

jest.mock('axios');

describe('URL Interpreter Service - Mercado Libre & E-Commerce Link Interpretation', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('parseUrlSlug', () => {
    test('1. Extrae correctamente el nombre del producto desde URLs con slug de Mercado Libre Uruguay', () => {
      const url =
        'https://www.mercadolibre.com.uy/panel-wpc-decorativo-revestimiento-pared-wall-panel/up/MLUU4824517083?pdp_filters=item_id%3AMLU1488361752&from=gshop';
      const result = urlInterpreterService.parseUrlSlug(url);

      expect(result).not.toBeNull();
      expect(result.isMercadoLibre).toBe(true);
      expect(result.platform).toBe('Mercado Libre');
      expect(result.productName).toBe('panel wpc decorativo revestimiento pared wall panel');
    });

    test('2. Extrae correctamente títulos desde artículos de Mercado Libre con prefijo MLU y sufijo _JM', () => {
      const url =
        'https://articulo.mercadolibre.com.uy/MLU-634918234-taladro-percutor-inalambrico-stanley-sbd715c2k-20v-brushless-_JM';
      const result = urlInterpreterService.parseUrlSlug(url);

      expect(result).not.toBeNull();
      expect(result.isMercadoLibre).toBe(true);
      expect(result.productName).toBe('taladro percutor inalambrico stanley sbd715c2k 20v brushless');
    });

    test('3. Extrae correctamente el producto desde URLs oficiales de Kroser Uruguay', () => {
      const url =
        'https://www.kroser.com.uy/catalogo/hidroesmalte-epoxi-pisos-y-paredes-1l-n-a_29289441003_29289441003';
      const result = urlInterpreterService.parseUrlSlug(url);

      expect(result).not.toBeNull();
      expect(result.isKroser).toBe(true);
      expect(result.platform).toBe('Kroser Uruguay');
      expect(result.productName).toBe('hidroesmalte epoxi pisos y paredes 1l');
    });

    test('4. Maneja URLs generales de otros e-commerce extrayendo el slug', () => {
      const url = 'https://www.sodimac.com.uy/productos/pintura-latex-lavable-alba-20-litros';
      const result = urlInterpreterService.parseUrlSlug(url);

      expect(result).not.toBeNull();
      expect(result.productName).toBe('pintura latex lavable alba 20 litros');
      expect(result.platform).toBe('sodimac.com.uy');
    });

    test('5. Retorna null ante URLs inválidas o vacías', () => {
      expect(urlInterpreterService.parseUrlSlug('')).toBeNull();
      expect(urlInterpreterService.parseUrlSlug('texto-sin-url')).toBeNull();
      expect(urlInterpreterService.parseUrlSlug(null)).toBeNull();
    });
  });

  describe('fetchPageMetadata', () => {
    test('6. Extrae OpenGraph title limpiando sufijos de marcas', async () => {
      axios.get.mockResolvedValueOnce({
        data: `
          <html>
            <head>
              <meta property="og:title" content="Panel Wpc Decorativo Revestimiento Pared | MercadoLibre.com.uy" />
              <meta property="og:description" content="Placas WPC para interior y exterior alta durabilidad." />
            </head>
          </html>
        `,
      });

      const meta = await urlInterpreterService.fetchPageMetadata('https://articulo.mercadolibre.com.uy/MLU-12345');
      expect(meta).not.toBeNull();
      expect(meta.title).toBe('Panel Wpc Decorativo Revestimiento Pared');
      expect(meta.description).toContain('Placas WPC');
    });

    test('7. Si falla la petición HTTP o da timeout, maneja el error sin lanzar excepción', async () => {
      axios.get.mockRejectedValueOnce(new Error('Network timeout'));

      const meta = await urlInterpreterService.fetchPageMetadata('https://sitio-caido.com/producto');
      expect(meta).toBeNull();
    });
  });

  describe('processMessageUrls', () => {
    test('8. Procesa un mensaje real con URL de Mercado Libre y enriquece el contenido para el bot', async () => {
      const userMessage =
        'https://www.mercadolibre.com.uy/panel-wpc-decorativo-revestimiento-pared-wall-panel/up/MLUU4824517083\nbuenos dias. Consulta. Veo que tienen estos paneles WPC. Necesitaría saber si tienen stock de 75 placas.';

      const result = await urlInterpreterService.processMessageUrls(userMessage, { fetchMeta: false });

      expect(result.hasUrls).toBe(true);
      expect(result.urls.length).toBe(1);
      expect(result.urls[0].isMercadoLibre).toBe(true);
      expect(result.urls[0].title).toBe('panel wpc decorativo revestimiento pared wall panel');
      expect(result.combinedSearchTerms).toContain('panel wpc decorativo revestimiento pared wall panel');
      expect(result.enrichedContent).toContain('[Enlace analizado de Mercado Libre:');
      expect(result.enrichedContent).toContain('panel wpc decorativo revestimiento pared wall panel');
    });

    test('9. Si el mensaje no contiene URLs, devuelve hasUrls: false sin alterar el contenido', async () => {
      const plainMessage = 'Hola, buenas tardes. Tienen pintura látex blanca?';
      const result = await urlInterpreterService.processMessageUrls(plainMessage, { fetchMeta: false });

      expect(result.hasUrls).toBe(false);
      expect(result.urls).toEqual([]);
      expect(result.enrichedContent).toBe(plainMessage);
    });
  });
});

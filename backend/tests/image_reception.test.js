/**
 * Test Suite: Flujo de Recepción y Procesamiento de Imágenes (Visual Parts Finder)
 */

const axios = require('axios');
const OpenAI = require('openai');
const mediaService = require('../services/media/mediaService');
const configuracionRepo = require('../repositories/configuracionRepository');

describe('Flujo de Recepción y Reconocimiento de Imágenes (Visual Parts Finder)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Detección y filtrado de adjuntos de imagen', () => {
    test('identifica correctamente adjuntos con file_type image', async () => {
      jest.spyOn(axios, 'get').mockResolvedValue({
        data: Buffer.from('fake-image-bytes'),
        headers: { 'content-type': 'image/jpeg' },
      });

      const attachments = [
        {
          file_type: 'image',
          extension: '.jpg',
          data_url: 'https://omnicanal.kroser.uy/rails/active_storage/blobs/canilla.jpg',
        },
      ];

      const res = await mediaService.processMessageAttachments(attachments);
      expect(res.mediaSummaries.length).toBe(1);
      expect(res.mediaSummaries[0]).toMatch(/cliente|imagen/i);
    });

    test('identifica formatos variados: png, webp, heic, gif', async () => {
      jest.spyOn(axios, 'get').mockResolvedValue({
        data: Buffer.from('fake-image-bytes'),
        headers: { 'content-type': 'image/webp' },
      });

      const attachments = [
        {
          file_type: 'file',
          content_type: 'image/webp',
          extension: '.webp',
          data_url: 'https://omnicanal.kroser.uy/repuesto.webp',
        },
        {
          file_type: 'file',
          content_type: 'image/heic',
          extension: '.heic',
          data_url: 'https://omnicanal.kroser.uy/foto_iphone.heic',
        },
      ];

      const res = await mediaService.processMessageAttachments(attachments);
      expect(res.mediaSummaries.length).toBe(2);
      expect(res.mediaSummaries[0]).toMatch(/cliente|imagen/i);
      expect(res.mediaSummaries[1]).toMatch(/cliente|imagen/i);
    });
  });

  describe('2. Estructuración y parseo de análisis visual', () => {
    test('analiza imagen y parsea IDENTIFICACIÓN, KEYWORDS y DETALLE con Gemini', async () => {
      jest.spyOn(axios, 'get').mockResolvedValue({
        data: Buffer.from('fake-image-bytes'),
        headers: { 'content-type': 'image/jpeg' },
      });

      jest.spyOn(axios, 'post').mockResolvedValue({
        data: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: `IDENTIFICACIÓN: Cartucho cerámico 35mm para canilla monocomando
KEYWORDS: cartucho ceramico 35mm monocomando
DETALLE: Repuesto interior para grifería monocomando de baño o cocina con cierre suave cerámico.`,
                  },
                ],
              },
            },
          ],
        },
      });

      jest.spyOn(configuracionRepo, 'getMultiple').mockResolvedValue({
        llm_provider: 'gemini',
        llm_api_key: 'fake-gemini-key',
      });
      jest.spyOn(configuracionRepo, 'get').mockResolvedValue('gemini-1.5-flash');

      const result = await mediaService.analyzeImage({
        url: 'https://omnicanal.kroser.uy/cartucho.jpg',
      });

      expect(result.partName).toBe('Cartucho cerámico 35mm para canilla monocomando');
      expect(result.searchTerms).toBe('cartucho ceramico 35mm monocomando');
      expect(result.description).toContain('Cartucho cerámico 35mm');
      expect(result.description).toContain('cartucho ceramico 35mm monocomando');
    });

    test('devuelve fallback elegante si la descarga falla', async () => {
      jest.spyOn(axios, 'get').mockRejectedValue(new Error('Network error 404'));

      const result = await mediaService.analyzeImage({
        url: 'https://omnicanal.kroser.uy/inexistente.jpg',
      });

      expect(result.description).toContain('Imagen enviada por el cliente');
      expect(result.searchTerms).toBe('');
      expect(result.partName).toBe('');
    });
  });

  describe('3. Conmutación Fail-Safe para Visión (Gemini <-> OpenAI)', () => {
    test('conmuta a OpenAI si Gemini Vision falla', async () => {
      jest.spyOn(axios, 'get').mockResolvedValue({
        data: Buffer.from('fake-image-bytes'),
        headers: { 'content-type': 'image/jpeg' },
      });

      // Gemini fails with 500 error
      jest.spyOn(axios, 'post').mockRejectedValue(new Error('Gemini API 500 Server Error'));

      jest.spyOn(configuracionRepo, 'getMultiple').mockResolvedValue({
        llm_provider: 'gemini',
        llm_fallback_provider: 'openai',
        llm_api_key: 'fake-gemini-key',
        llm_fallback_api_key: 'fake-openai-key',
      });
      jest.spyOn(configuracionRepo, 'get').mockResolvedValue('gemini-1.5-flash');

      // Spy on completions.create cleanly without global module mock
      const dummy = new OpenAI({ apiKey: 'dummy-test' });
      const proto = Object.getPrototypeOf(dummy.chat.completions);
      const spy = jest.spyOn(proto, 'create').mockResolvedValue({
        choices: [
          {
            message: {
              content: 'IDENTIFICACIÓN: Llave de paso esférica 1/2 pulgada\nKEYWORDS: llave de paso esferica 1/2\nDETALLE: Válvula de corte para instalación de agua.',
            },
          },
        ],
      });

      const result = await mediaService.analyzeImage({
        url: 'https://omnicanal.kroser.uy/llave.jpg',
      });

      expect(result.partName).toBe('Llave de paso esférica 1/2 pulgada');
      expect(result.searchTerms).toBe('llave de paso esferica 1/2');

      spy.mockRestore();
    });
  });
});

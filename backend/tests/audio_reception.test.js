const mediaService = require('../services/media/mediaService');
const configuracionRepo = require('../repositories/configuracionRepository');

jest.mock('../repositories/configuracionRepository');
jest.mock('../config/logger');

describe('Audio Reception & Multimodal Transcription Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Detección de formatos de audio y extensiones WhatsApp', () => {
    test('detecta notas de voz con extensión .opus y file_type audio', async () => {
      const attachments = [
        {
          file_type: 'audio',
          extension: '.opus',
          content_type: 'audio/ogg; codecs=opus',
          data_url: 'https://fake-cdn.kroser.uy/voice.opus',
        },
      ];
      const res = await mediaService.processMessageAttachments(attachments);
      expect(res.transcribedTexts.length).toBe(1);
      expect(res.mediaSummaries[0]).toMatch(/Audio/);
    });

    test('detecta audio con content_type audio/ogg sin importar file_type', async () => {
      const attachments = [
        {
          file_type: 'file',
          extension: '.oga',
          content_type: 'audio/ogg',
          data_url: 'https://fake-cdn.kroser.uy/voice.oga',
        },
      ];
      const res = await mediaService.processMessageAttachments(attachments);
      expect(res.transcribedTexts.length).toBe(1);
      expect(res.mediaSummaries[0]).toMatch(/Audio/);
    });

    test('detecta notas de voz con file_type voice (Telegram/Chatwoot)', async () => {
      const attachments = [
        {
          file_type: 'voice',
          data_url: 'https://fake-cdn.kroser.uy/voice_note',
        },
      ];
      const res = await mediaService.processMessageAttachments(attachments);
      expect(res.transcribedTexts.length).toBe(1);
      expect(res.mediaSummaries[0]).toMatch(/Audio/);
    });
  });

  describe('2. Fallback elegante cuando no se puede descargar el audio', () => {
    test('retorna mensaje indicando fallo de descarga si la URL no es válida', async () => {
      const result = await mediaService.transcribeAudio({
        url: null,
        data_url: null,
      });
      expect(result).toBe('[Audio recibido - no se pudo descargar]');
    });

    test('retorna mensaje genérico amigable si ambos proveedores fallan', async () => {
      configuracionRepo.get.mockImplementation(async (key) => {
        if (key === 'llm_provider') return 'gemini';
        if (key === 'llm_api_key') return 'invalid_key';
        return null;
      });

      const result = await mediaService.transcribeAudio({
        url: 'https://fake-cdn.kroser.uy/unreachable.ogg',
        extension: '.ogg',
      });
      expect(result).toBe('[Mensaje de voz / Audio recibido del cliente]');
    });
  });
});

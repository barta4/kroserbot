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

  describe('3. Webhook Schema & Controller Integration para Audios e Imágenes (content: null)', () => {
    const { webhookPayloadSchema } = require('../schemas');
    const debounceService = require('../services/webhook/debounceService');

    test('acepta y valida exitosamente payload de WhatsApp con audio y content: null', () => {
      const whatsappAudioPayload = {
        event: 'message_created',
        id: 99101,
        content: null,
        message_type: 'incoming',
        conversation: { id: 4567, account_id: 1 },
        account: { id: 1 },
        sender: { id: 111, type: 'contact', name: '+59899111222' },
        attachments: [
          {
            id: 888,
            file_type: 'audio',
            extension: '.oga',
            content_type: 'audio/ogg; codecs=opus',
            data_url: 'https://omnicanal.kroser.uy/rails/active_storage/blobs/redirect/voice.oga',
          },
        ],
      };

      const parsed = webhookPayloadSchema.safeParse(whatsappAudioPayload);
      expect(parsed.success).toBe(true);
      expect(parsed.data.content).toBe('');
      expect(parsed.data.attachments.length).toBe(1);
    });

    test('acepta y valida exitosamente payload de WhatsApp con imagen y message.content: null', () => {
      const whatsappImagePayload = {
        event: 'message_created',
        message: {
          id: 99102,
          content: null,
          message_type: 0,
          sender: { id: 222, type: 'contact', name: 'Cliente' },
          attachments: [
            {
              id: 889,
              file_type: 'image',
              extension: '.jpg',
              content_type: 'image/jpeg',
              data_url: 'https://omnicanal.kroser.uy/rails/active_storage/blobs/redirect/canilla.jpg',
            },
          ],
        },
        conversation: { id: 4567, account_id: 1 },
        account: { id: 1 },
      };

      const parsed = webhookPayloadSchema.safeParse(whatsappImagePayload);
      expect(parsed.success).toBe(true);
      expect(parsed.data.message.content).toBe('');
      expect(parsed.data.message.attachments.length).toBe(1);
    });

    test('debounceService.getAndClear devuelve el texto acumulado y cancela el timer pendiente', async () => {
      let executed = false;
      debounceService.addMessage(99999, 'Tengo una canilla rota', () => {
        executed = true;
      });

      const flushedText = debounceService.getAndClear(99999);
      expect(flushedText).toBe('Tengo una canilla rota');

      // Esperar tiempo suficiente para asegurar que el timer cancelado no se ejecuta
      await new Promise((r) => setTimeout(r, 50));
      expect(executed).toBe(false);
    });
  });
});

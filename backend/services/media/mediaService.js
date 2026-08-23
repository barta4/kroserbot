require('dotenv').config();
const logger = require('../../config/logger');
const configuracionRepo = require('../../repositories/configuracionRepository');

let axios = null;
try {
  axios = require('axios');
} catch (_err) {
  axios = null;
}

/**
 * Downloads media from URL as base64 and determines mimeType
 */
async function fetchMediaAsBase64(url) {
  if (!axios || !url) return null;
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
    });
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    const buffer = Buffer.from(response.data);
    const base64 = buffer.toString('base64');
    return { base64, mimeType: contentType, buffer };
  } catch (err) {
    logger.warn('Failed to download media attachment', { url, error: err.message });
    return null;
  }
}

/**
 * Transcribe Audio using Gemini or OpenAI Whisper
 */
async function transcribeAudio({ url, data_url, mime_type, extension }) {
  const mediaUrl = url || data_url;
  if (!mediaUrl) return '[Audio recibido - no se pudo descargar]';

  const provider = (await configuracionRepo.get('llm_provider')) || (process.env.GEMINI_API_KEY ? 'gemini' : 'openai');
  const geminiKey = (await configuracionRepo.get('llm_api_key')) || process.env.GEMINI_API_KEY;
  const openaiKey = (await configuracionRepo.get('llm_api_key')) || process.env.OPENAI_API_KEY;

  // 1. Try Gemini Multimodal for Audio
  if (provider === 'gemini' && geminiKey) {
    try {
      const mediaData = await fetchMediaAsBase64(mediaUrl);
      if (mediaData) {
        let mime = mime_type || mediaData.mimeType;
        if (mime === 'application/octet-stream' || !mime) {
          if (extension?.includes('ogg') || mediaUrl.includes('.ogg')) mime = 'audio/ogg';
          else if (extension?.includes('mp3') || mediaUrl.includes('.mp3')) mime = 'audio/mp3';
          else if (extension?.includes('wav') || mediaUrl.includes('.wav')) mime = 'audio/wav';
          else mime = 'audio/mp3';
        }

        const promptText = 'Transcribe exactamente el mensaje de voz o audio del cliente en español rioplatense/uruguayo. Devuelve únicamente el texto transcripto, sin explicaciones ni comentarios adicionales.';
        
        if (axios) {
          const geminiModel = (await configuracionRepo.get('llm_model')) || 'gemini-1.5-flash';
          const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;
          const res = await axios.post(apiUrl, {
            contents: [
              {
                parts: [
                  { text: promptText },
                  {
                    inlineData: {
                      mimeType: mime,
                      data: mediaData.base64,
                    },
                  },
                ],
              },
            ],
          }, { timeout: 20000 });

          const transcription = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (transcription && transcription.trim()) {
            logger.info('Audio transcribed successfully with Gemini', { length: transcription.length });
            return transcription.trim();
          }
        }
      }
    } catch (err) {
      logger.warn('Gemini audio transcription failed', { error: err.message });
    }
  }

  // 2. Try OpenAI Whisper for Audio
  if (openaiKey) {
    try {
      const mediaData = await fetchMediaAsBase64(mediaUrl);
      if (mediaData) {
        const OpenAI = require('openai');
        const openai = new OpenAI({ apiKey: openaiKey });
        
        const { toFile } = require('openai');
        const fileName = `audio_${Date.now()}.${extension?.replace('.', '') || 'mp3'}`;
        const fileObj = await toFile(mediaData.buffer, fileName);

        const transcription = await openai.audio.transcriptions.create({
          file: fileObj,
          model: 'whisper-1',
          language: 'es',
        });

        if (transcription?.text) {
          logger.info('Audio transcribed successfully with OpenAI Whisper', { length: transcription.text.length });
          return transcription.text.trim();
        }
      }
    } catch (err) {
      logger.warn('OpenAI Whisper audio transcription failed', { error: err.message });
    }
  }

  return '[Mensaje de voz / Audio recibido del cliente]';
}

/**
 * Analyze Image using Gemini Vision or OpenAI Vision
 */
async function analyzeImage({ url, data_url, mime_type }) {
  const mediaUrl = url || data_url;
  if (!mediaUrl) return '[Imagen adjunta recibida]';

  const geminiKey = (await configuracionRepo.get('llm_api_key')) || process.env.GEMINI_API_KEY;
  const openaiKey = (await configuracionRepo.get('llm_api_key')) || process.env.OPENAI_API_KEY;

  const promptText = 'Sos el asistente virtual de ferretería Kroser Uruguay. Analizá esta foto enviada por el cliente. Describí brevemente qué producto, herramienta, repuesto, código, factura o problema técnico se observa en la imagen para poder asesorarlo.';

  // 1. Try Gemini Vision
  if (geminiKey) {
    try {
      const mediaData = await fetchMediaAsBase64(mediaUrl);
      if (mediaData) {
        const mime = mime_type || mediaData.mimeType || 'image/jpeg';
        const geminiModel = (await configuracionRepo.get('llm_model')) || 'gemini-1.5-flash';
        
        if (axios) {
          const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;
          const res = await axios.post(apiUrl, {
            contents: [
              {
                parts: [
                  { text: promptText },
                  {
                    inlineData: {
                      mimeType: mime,
                      data: mediaData.base64,
                    },
                  },
                ],
              },
            ],
          }, { timeout: 20000 });

          const description = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (description && description.trim()) {
            logger.info('Image analyzed successfully with Gemini Vision', { length: description.length });
            return description.trim();
          }
        }
      }
    } catch (err) {
      logger.warn('Gemini vision analysis failed', { error: err.message });
    }
  }

  // 2. Try OpenAI GPT-4o-mini Vision
  if (openaiKey) {
    try {
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: openaiKey });

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: promptText },
              {
                type: 'image_url',
                image_url: { url: mediaUrl },
              },
            ],
          },
        ],
        max_tokens: 250,
      });

      const description = response.choices?.[0]?.message?.content;
      if (description && description.trim()) {
        logger.info('Image analyzed successfully with OpenAI Vision', { length: description.length });
        return description.trim();
      }
    } catch (err) {
      logger.warn('OpenAI vision analysis failed', { error: err.message });
    }
  }

  return '[Imagen enviada por el cliente: producto o consulta visual de ferretería]';
}

/**
 * Process all attachments from a Chatwoot message
 */
async function processMessageAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return { mediaSummaries: [], transcribedTexts: [] };
  }

  const mediaSummaries = [];
  const transcribedTexts = [];

  for (const att of attachments) {
    const fileType = (att.file_type || '').toLowerCase();
    const extension = (att.extension || '').toLowerCase();
    const url = att.data_url || att.url || att.thumb_url;

    if (fileType === 'audio' || extension.includes('ogg') || extension.includes('mp3') || extension.includes('wav') || extension.includes('m4a') || url?.includes('.ogg') || url?.includes('.mp3')) {
      logger.info('Processing audio attachment in message', { url });
      const transcription = await transcribeAudio({
        url,
        data_url: att.data_url,
        mime_type: att.content_type,
        extension: att.extension,
      });
      transcribedTexts.push(transcription);
      mediaSummaries.push(`[Audio transcripto: "${transcription}"]`);
    } else if (fileType === 'image' || extension.includes('jpg') || extension.includes('jpeg') || extension.includes('png') || extension.includes('webp') || url?.includes('.jpg') || url?.includes('.png')) {
      logger.info('Processing image attachment in message', { url });
      const imageDescription = await analyzeImage({
        url,
        data_url: att.data_url,
        mime_type: att.content_type,
      });
      mediaSummaries.push(`[El cliente adjuntó una imagen. Análisis visual: ${imageDescription}]`);
    } else {
      mediaSummaries.push(`[Archivo adjunto: ${att.filename || att.name || 'documento'}]`);
    }
  }

  return { mediaSummaries, transcribedTexts };
}

module.exports = {
  transcribeAudio,
  analyzeImage,
  processMessageAttachments,
  fetchMediaAsBase64,
};

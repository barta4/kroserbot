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
 * Specialized Visual Parts Finder for Hardware Store (Kroser Uruguay)
 */
async function analyzeImage({ url, data_url, mime_type }) {
  const mediaUrl = url || data_url;
  if (!mediaUrl) return { description: '[Imagen adjunta recibida]', searchTerms: '', partName: '' };

  const geminiKey = (await configuracionRepo.get('llm_api_key')) || process.env.GEMINI_API_KEY;
  const openaiKey = (await configuracionRepo.get('llm_api_key')) || process.env.OPENAI_API_KEY;

  const hardwareVisionPrompt = `Sos el Asistente Técnico y Maestro Ferretero de Ferreterías Kroser Uruguay.
Analizá minuciosamente la foto enviada por el cliente (puede ser una pieza rota, repuesto sanitario, tornillo, cerradura, herramienta, canilla, perfil, pintura o problema del hogar).

Tu tarea:
1. Identificar la pieza, herramienta o repuesto con precisión técnica (ej: 'Cartucho cerámico 35mm para canilla monocomando', 'Flexible mallado de 1/2 pulgada', 'Cuerito de goma para canilla tradicional', 'Tornillo autorroscante T2 para placa yeso', 'Disco de corte para amoladora 115mm', 'Taco Fischer DuoPower', 'Cerradura pomo para baño').
2. Extraer medidas, materiales o características visibles (roscas, diámetros, acabado, marca).
3. Indicar las 2 a 4 palabras clave exactas para buscar el repuesto o producto equivalente en el catálogo de Kroser.

Respondé en este formato exacto:
IDENTIFICACIÓN: <Nombre técnico claro de la pieza o problema>
KEYWORDS: <palabras clave separadas por espacio o coma para buscar en catálogo>
DETALLE: <Explicación breve de 1 o 2 oraciones para el cliente sobre qué pieza es y qué función cumple>`;

  let rawAnalysis = '';

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
                  { text: hardwareVisionPrompt },
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

          const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text && text.trim()) {
            rawAnalysis = text.trim();
          }
        }
      }
    } catch (err) {
      logger.warn('Gemini hardware vision analysis failed', { error: err.message });
    }
  }

  // 2. Try OpenAI GPT-4o-mini Vision
  if (!rawAnalysis && openaiKey) {
    try {
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: openaiKey });

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: hardwareVisionPrompt },
              {
                type: 'image_url',
                image_url: { url: mediaUrl },
              },
            ],
          },
        ],
        max_tokens: 300,
      });

      const text = response.choices?.[0]?.message?.content;
      if (text && text.trim()) {
        rawAnalysis = text.trim();
      }
    } catch (err) {
      logger.warn('OpenAI hardware vision analysis failed', { error: err.message });
    }
  }

  if (!rawAnalysis) {
    return {
      description: '[Imagen enviada por el cliente: producto o consulta visual de ferretería]',
      searchTerms: '',
      partName: '',
    };
  }

  // Parse structured sections
  const identMatch = rawAnalysis.match(/IDENTIFICACI[ÓO]N:\s*([^\n]+)/i);
  const keywordsMatch = rawAnalysis.match(/KEYWORDS:\s*([^\n]+)/i);
  const detalleMatch = rawAnalysis.match(/DETALLE:\s*([\s\S]+)/i);

  const partName = identMatch ? identMatch[1].trim() : '';
  const searchTerms = keywordsMatch ? keywordsMatch[1].trim() : partName;
  const detalle = detalleMatch ? detalleMatch[1].trim() : rawAnalysis;

  const description = partName
    ? `[Foto del cliente identificada: ${partName}. ${detalle}]`
    : `[Análisis visual de ferretería: ${rawAnalysis}]`;

  logger.info('Visual Part Identified', { partName, searchTerms });

  return {
    description,
    searchTerms,
    partName,
    rawAnalysis,
  };
}

/**
 * Process all attachments from a Chatwoot message
 */
async function processMessageAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return { mediaSummaries: [], transcribedTexts: [], visualSearchTerms: [], identifiedParts: [] };
  }

  const mediaSummaries = [];
  const transcribedTexts = [];
  const visualSearchTerms = [];
  const identifiedParts = [];

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
      logger.info('Processing image attachment in message (Visual Parts Finder)', { url });
      const imageResult = await analyzeImage({
        url,
        data_url: att.data_url,
        mime_type: att.content_type,
      });
      mediaSummaries.push(imageResult.description);
      if (imageResult.searchTerms) {
        visualSearchTerms.push(imageResult.searchTerms);
      }
      if (imageResult.partName) {
        identifiedParts.push(imageResult.partName);
      }
    } else {
      mediaSummaries.push(`[Archivo adjunto: ${att.filename || att.name || 'documento'}]`);
    }
  }

  return { mediaSummaries, transcribedTexts, visualSearchTerms, identifiedParts };
}

module.exports = {
  transcribeAudio,
  analyzeImage,
  processMessageAttachments,
  fetchMediaAsBase64,
};

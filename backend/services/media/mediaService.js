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
 * Resolves API keys cleanly according to provider and fallback settings
 */
async function getApiKeys() {
  const configs = (await configuracionRepo.getMultiple([
    'llm_provider',
    'llm_fallback_provider',
    'llm_api_key',
    'llm_fallback_api_key',
  ])) || {};

  const provider = configs.llm_provider || 'gemini';
  const fallbackProvider = configs.llm_fallback_provider || (provider === 'gemini' ? 'openai' : 'gemini');

  const primaryKey = configs.llm_api_key;
  const fallbackKey = configs.llm_fallback_api_key;

  let geminiKey = process.env.GEMINI_API_KEY || '';
  let openaiKey = process.env.OPENAI_API_KEY || '';

  if (provider === 'gemini' && primaryKey && primaryKey.trim()) {
    geminiKey = primaryKey.trim();
  } else if (fallbackProvider === 'gemini' && fallbackKey && fallbackKey.trim()) {
    geminiKey = fallbackKey.trim();
  }

  if (provider === 'openai' && primaryKey && primaryKey.trim()) {
    openaiKey = primaryKey.trim();
  } else if (fallbackProvider === 'openai' && fallbackKey && fallbackKey.trim()) {
    openaiKey = fallbackKey.trim();
  }

  return { geminiKey, openaiKey, provider };
}

/**
 * Downloads media from URL as base64 and determines mimeType
 */
async function fetchMediaAsBase64(url) {
  if (!axios || !url) return null;
  try {
    let targetUrl = url;
    if (targetUrl.startsWith('/') && !targetUrl.startsWith('//')) {
      const dbUrl = await configuracionRepo.get('chatwoot_base_url');
      const baseUrl = (dbUrl && dbUrl.trim()) || process.env.CHATWOOT_BASE_URL || process.env.CHATWOOT_API_URL || 'https://omnicanal.kroser.uy';
      targetUrl = `${baseUrl.replace(/\/+$/, '')}${targetUrl}`;
    }
    const headers = {};
    const dbToken = await configuracionRepo.get('chatwoot_api_token');
    const token = (dbToken && dbToken.trim()) || process.env.CHATWOOT_API_ACCESS_TOKEN || process.env.CHATWOOT_API_TOKEN;
    if (token && (targetUrl.includes('uruchat.com') || targetUrl.includes('kroser.uy') || targetUrl.startsWith('/'))) {
      headers['api_access_token'] = token;
    }
    const response = await axios.get(targetUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      maxRedirects: 5,
      headers,
    });
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    const buffer = Buffer.from(response.data);
    const base64 = buffer.toString('base64');
    return { base64, mimeType: contentType, buffer };
  } catch (err) {
    logger.warn('Failed to download media attachment', { url, error: err.message, status: err.response?.status });
    return null;
  }
}

/**
 * Transcribe Audio using Gemini or OpenAI Whisper
 */
async function transcribeAudio({ url, data_url, mime_type, extension }) {
  const mediaUrl = url || data_url;
  if (!mediaUrl) return '[Audio recibido - no se pudo descargar]';

  const { geminiKey, openaiKey } = await getApiKeys();

  // 1. Try Gemini Multimodal for Audio
  if (geminiKey) {
    try {
      const mediaData = await fetchMediaAsBase64(mediaUrl);
      if (mediaData) {
        let mime = (mime_type || mediaData.mimeType || '').split(';')[0].trim().toLowerCase();
        // Normalize WhatsApp / Uruchat audio formats for Google Gemini
        if (mime === 'audio/opus' || mime === 'audio/oga' || mime === 'application/ogg' || mime === 'audio/x-opus') {
          mime = 'audio/ogg';
        } else if (mime === 'audio/x-wav') {
          mime = 'audio/wav';
        } else if (mime === 'audio/x-m4a') {
          mime = 'audio/mp4';
        } else if (mime === 'application/octet-stream' || !mime) {
          if (extension?.includes('ogg') || mediaUrl.includes('.ogg') || extension?.includes('opus') || mediaUrl.includes('.opus') || extension?.includes('oga')) {
            mime = 'audio/ogg';
          } else if (extension?.includes('mp3') || mediaUrl.includes('.mp3')) {
            mime = 'audio/mp3';
          } else if (extension?.includes('wav') || mediaUrl.includes('.wav')) {
            mime = 'audio/wav';
          } else if (extension?.includes('m4a') || mediaUrl.includes('.m4a') || extension?.includes('aac')) {
            mime = 'audio/mp4';
          } else if (extension?.includes('webm') || mediaUrl.includes('.webm')) {
            mime = 'audio/webm';
          } else {
            mime = 'audio/ogg';
          }
        }

        const promptText = 'Transcribe exactamente el mensaje de voz o audio del cliente en español rioplatense/uruguayo. Devuelve únicamente el texto transcripto, sin explicaciones ni comentarios adicionales.';
        
        if (axios) {
          let geminiModel = (await configuracionRepo.get('llm_model')) || 'gemini-1.5-flash';
          if (!geminiModel.toLowerCase().startsWith('gemini')) {
            const fbModel = await configuracionRepo.get('llm_fallback_model');
            geminiModel = (fbModel && fbModel.toLowerCase().startsWith('gemini')) ? fbModel : 'gemini-1.5-flash';
          }
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
      const errMsg = err.response?.data?.error?.message || err.message;
      logger.warn('Gemini audio transcription failed', { error: errMsg, status: err.response?.status });
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
        let ext = (extension?.replace('.', '') || '').toLowerCase();
        if (!ext || ext === 'octet-stream') {
          if (mediaUrl.includes('.ogg') || mediaUrl.includes('.opus') || (mime_type && mime_type.includes('ogg'))) ext = 'ogg';
          else if (mediaUrl.includes('.mp3') || (mime_type && mime_type.includes('mp3'))) ext = 'mp3';
          else if (mediaUrl.includes('.wav') || (mime_type && mime_type.includes('wav'))) ext = 'wav';
          else if (mediaUrl.includes('.m4a') || (mime_type && mime_type.includes('m4a'))) ext = 'm4a';
          else ext = 'ogg';
        }
        const fileName = `voice_${Date.now()}.${ext}`;
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
      const errMsg = err.response?.data?.error?.message || err.message;
      logger.warn('OpenAI Whisper audio transcription failed', { error: errMsg, status: err.response?.status });
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

  const { geminiKey, openaiKey, provider } = await getApiKeys();

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

  // Download media as base64 so bytes are available locally for both Gemini and OpenAI
  const mediaData = await fetchMediaAsBase64(mediaUrl);
  if (!mediaData || !mediaData.base64) {
    logger.warn('Could not download image attachment for vision analysis', { mediaUrl });
    return {
      description: '[Imagen enviada por el cliente: producto o consulta visual de ferretería]',
      searchTerms: '',
      partName: '',
    };
  }

  let mime = (mime_type || mediaData.mimeType || 'image/jpeg').split(';')[0].trim().toLowerCase();
  if (mime === 'application/octet-stream' || !mime) {
    if (mediaUrl.includes('.png')) mime = 'image/png';
    else if (mediaUrl.includes('.webp')) mime = 'image/webp';
    else if (mediaUrl.includes('.gif')) mime = 'image/gif';
    else mime = 'image/jpeg';
  }

  const runGeminiVision = async () => {
    if (!geminiKey || !axios) return null;
    let geminiModel = (await configuracionRepo.get('llm_model')) || 'gemini-1.5-flash';
    if (!geminiModel.toLowerCase().startsWith('gemini')) {
      const fbModel = await configuracionRepo.get('llm_fallback_model');
      geminiModel = (fbModel && fbModel.toLowerCase().startsWith('gemini')) ? fbModel : 'gemini-1.5-flash';
    }
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
    return res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  };

  const runOpenAIVision = async () => {
    if (!openaiKey) return null;
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: openaiKey });
    const dataUrl = `data:${mime};base64,${mediaData.base64}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: hardwareVisionPrompt },
            {
              type: 'image_url',
              image_url: { url: dataUrl },
            },
          ],
        },
      ],
      max_tokens: 300,
    });
    return response.choices?.[0]?.message?.content?.trim() || null;
  };

  // Provider preference with automatic fail-safe
  if (provider === 'openai') {
    try {
      rawAnalysis = await runOpenAIVision();
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.message;
      logger.warn('OpenAI hardware vision analysis failed, trying Gemini fallback', { error: errMsg });
    }
    if (!rawAnalysis) {
      try {
        rawAnalysis = await runGeminiVision();
      } catch (err) {
        const errMsg = err.response?.data?.error?.message || err.message;
        logger.warn('Gemini hardware vision fallback failed', { error: errMsg });
      }
    }
  } else {
    try {
      rawAnalysis = await runGeminiVision();
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.message;
      logger.warn('Gemini hardware vision analysis failed, trying OpenAI fallback', { error: errMsg });
    }
    if (!rawAnalysis) {
      try {
        rawAnalysis = await runOpenAIVision();
      } catch (err) {
        const errMsg = err.response?.data?.error?.message || err.message;
        logger.warn('OpenAI hardware vision fallback failed', { error: errMsg });
      }
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
    ? `[Foto del cliente identificada: ${partName}. ${detalle}${searchTerms ? ` | Términos de búsqueda sugeridos: ${searchTerms}` : ''}]`
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
    const contentType = (att.content_type || '').toLowerCase();
    const extension = (att.extension || '').toLowerCase();
    const url = att.data_url || att.url || att.thumb_url || '';

    const isAudio = (
      fileType === 'audio' ||
      fileType === 'voice' ||
      contentType.startsWith('audio/') ||
      extension.includes('ogg') ||
      extension.includes('oga') ||
      extension.includes('opus') ||
      extension.includes('mp3') ||
      extension.includes('wav') ||
      extension.includes('m4a') ||
      extension.includes('aac') ||
      extension.includes('weba') ||
      url.includes('.ogg') ||
      url.includes('.opus') ||
      url.includes('.mp3')
    );

    const isImage = (
      fileType === 'image' ||
      contentType.startsWith('image/') ||
      extension.includes('jpg') ||
      extension.includes('jpeg') ||
      extension.includes('png') ||
      extension.includes('webp') ||
      extension.includes('gif') ||
      extension.includes('bmp') ||
      extension.includes('heic') ||
      extension.includes('heif') ||
      url.includes('.jpg') ||
      url.includes('.jpeg') ||
      url.includes('.png') ||
      url.includes('.webp') ||
      url.includes('.gif')
    );

    if (isAudio) {
      logger.info('Processing audio attachment in message', { url });
      const transcription = await transcribeAudio({
        url,
        data_url: att.data_url,
        mime_type: att.content_type,
        extension: att.extension,
      });
      transcribedTexts.push(transcription);
      mediaSummaries.push(`[Audio transcripto: "${transcription}"]`);
    } else if (isImage) {
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

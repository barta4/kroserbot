/**
 * Políticas de atención por canal.
 *
 * El objetivo es que WhatsApp (canal con costo por mensaje de Meta) sea
 * determinista, breve y acotado, mientras que el resto de los canales puede
 * explayarse y ofrecer alternativas.
 */

const configuracionRepo = require('../../repositories/configuracionRepository');
const logger = require('../../config/logger');

const WHATSAPP_ZERO_RESULT_FALLBACK =
  'Hola, no tenemos ese artículo en el catálogo. Consultá en Av. 8 de Octubre 3452 (La Unión) o llamá al 2508 3100 / 2509 7508.';

const WHATSAPP = {
  id: 'whatsapp',
  label: 'WhatsApp',
  maxChars: 300,
  maxMessages: 1,
  allowLists: false,
  allowAlternatives: false,
  allowClarifyingQuestion: false,
  zeroResultStrategy: 'contact',
};

const STANDARD = {
  id: 'standard',
  label: 'Web / otros canales',
  maxChars: 1600,
  maxMessages: 1,
  allowLists: true,
  allowAlternatives: true,
  allowClarifyingQuestion: true,
  zeroResultStrategy: 'legacy',
};

/**
 * Normaliza el valor de canal que entrega Chatwoot/Uruchat.
 * Puede venir como "Channel::Whatsapp", "whatsapp", "Channel::WebWidget", etc.
 */
function normalizeChannel(rawChannel) {
  const value = String(rawChannel || '').toLowerCase();
  if (value.includes('whatsapp')) return 'whatsapp';
  if (value.includes('instagram')) return 'instagram';
  if (value.includes('web') || value.includes('landing') || value.includes('widget')) return 'web';
  return 'standard';
}

function resolveChannelPolicy(rawChannel) {
  return normalizeChannel(rawChannel) === 'whatsapp' ? WHATSAPP : STANDARD;
}

/**
 * Mensaje único y determinista para WhatsApp cuando la búsqueda no encontró
 * nada. Se puede sobreescribir desde el panel con la clave
 * `msg_sin_resultado_whatsapp`.
 */
async function getWhatsAppZeroResultMessage() {
  try {
    const configured = await configuracionRepo.get('msg_sin_resultado_whatsapp');
    if (configured && configured.trim()) return configured.trim();
  } catch (err) {
    logger.warn('[ChannelPolicy] No se pudo leer msg_sin_resultado_whatsapp', { error: err.message });
  }
  return WHATSAPP_ZERO_RESULT_FALLBACK;
}

/**
 * Recorta una respuesta para que entre en un único mensaje de WhatsApp sin
 * cortar teléfonos, direcciones ni palabras por la mitad.
 */
function clampReply(text, policy = STANDARD) {
  const value = String(text || '').trim();
  if (!value || !policy || !policy.maxChars) return value;
  if (value.length <= policy.maxChars) return value;

  const slice = value.slice(0, policy.maxChars);
  const lastSentence = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('.\n'),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? ')
  );
  if (lastSentence >= Math.floor(policy.maxChars * 0.5)) {
    return slice.slice(0, lastSentence + 1).trim();
  }

  const lastSpace = slice.lastIndexOf(' ');
  return `${slice.slice(0, lastSpace > 0 ? lastSpace : policy.maxChars).trim()}…`;
}

module.exports = {
  WHATSAPP,
  STANDARD,
  WHATSAPP_ZERO_RESULT_FALLBACK,
  normalizeChannel,
  resolveChannelPolicy,
  getWhatsAppZeroResultMessage,
  clampReply,
};

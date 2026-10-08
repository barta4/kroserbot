const crypto = require('crypto');
const redis = require('../../config/redis');
const configuracionRepo = require('../../repositories/configuracionRepository');
const logger = require('../../config/logger');
const { normalize } = require('../../utils/textNormalizer');

// Patrones típicos de auto-respondedores y mensajes de ausencia / fuera de horario
const AUTO_RESPONDER_PATTERNS = [
  'gracias por comunicarte con',
  'gracias por contactarte con',
  'gracias por escribirnos',
  'gracias por contactar a',
  'gracias por escribir a',
  'nuestro horario de atencion es',
  'nuestro horario de atencion:',
  'nuestros horarios de atencion son',
  'horario de atencion de lunes a',
  'fuera de nuestro horario de atencion',
  'nos encontramos fuera de horario',
  'estamos fuera del horario',
  'en este momento no podemos responder',
  'en este momento no podemos atenderte',
  'en este momento no estamos disponibles',
  'te responderemos a la brevedad',
  'le responderemos a la brevedad',
  'nos pondremos en contacto a la brevedad',
  'un asesor se comunicara a la brevedad',
  'mensaje automatico',
  'respuesta automatica',
  'contestador automatico',
  'esta es una respuesta automatica',
  'este es un mensaje automatico',
  'no responda a este mensaje',
  'do not reply',
  'dejanos tu consulta y te responderemos',
  'deje su mensaje y nos comunicaremos',
  'out of office',
  'auto reply',
  'autoreply',
];

// Declaraciones explícitas de bots o asistentes de IA de terceros
const BOT_IDENTITY_PATTERNS = [
  'soy un bot',
  'soy el bot de',
  'soy un asistente virtual',
  'asistente virtual de',
  'asistente automatizado',
  'soy una inteligencia artificial',
  'soy una ia',
  'modelo de lenguaje de ia',
  'asistente de atencion automatica',
];

// Patrones de menús interactivos / IVR
const IVR_INDICATOR_PATTERNS = [
  'seleccione una opcion',
  'elija una opcion',
  'marque la opcion',
  'ingrese el numero de opcion',
  'digite la opcion',
  'escriba menu para volver',
  'menu principal:',
];

// Frases cortas de agradecimiento o despedida de cierre
const FAREWELL_CLOSING_PATTERNS = [
  'gracias',
  'muchas gracias',
  'muchisimas gracias',
  'mil gracias',
  'gracias por todo',
  'a vos',
  'a ustedes',
  'chau',
  'hasta luego',
  'nos vemos',
  'que pases bien',
  'que pases lindo',
  'que tenga buen dia',
  'que tengas buen dia',
  'que pases muy bien',
  'impecable gracias',
  'dale gracias',
  'perfecto gracias',
  'buenisimo gracias',
  'listo gracias',
];

// Frases habituales con las que Kroserbot concluye una despedida
const ASSISTANT_FAREWELL_SIGNALS = [
  'muchas gracias por comunicarse con kroser',
  'gracias por contactarse con kroser',
  'que tenga un excelente dia',
  'que pase muy bien',
  'ha sido un placer atenderlo',
  'a su completa disposicion',
  'quedamos a las ordenes',
  'a las ordenes',
];



// Patrones y remitentes específicos de correos No-Reply (notificaciones automáticas sin respuesta)
const NO_REPLY_EXACT_EMAILS = [
  'noreply@business-updates.facebook.com',
];

const NO_REPLY_EMAIL_PREFIXES = [
  'noreply@',
  'no-reply@',
  'no_reply@',
  'donotreply@',
  'do-not-reply@',
  'do_not_reply@',
  'naoresponda@',
  'nao-responda@',
  'automated@',
  'notification@',
  'notifications@',
];

const NO_REPLY_EMAIL_DOMAINS = [
  'business-updates.facebook.com',
  'facebookmail.com',
];

const NO_REPLY_SENDER_NAMES = [
  'no-reply',
  'noreply',
  'do not reply',
  'no responder',
  'nao responda',
  'notificaciones automaticas',
];

const NO_REPLY_BODY_PATTERNS = [
  'noreply@business-updates.facebook.com',
  'from: noreply@',
  'from: no-reply@',
  'de: noreply@',
  'de: no-reply@',
  'este es un correo automatico por favor no responda',
  'este es un mensaje automatico por favor no responda',
  'correo generado automaticamente no responder',
  'mensaje generado automaticamente no responder',
  'direccion no monitoreada',
  'casilla no monitoreada',
  'do not reply to this email',
  'do not reply to this message',
  'this email was sent from a notification-only address',
  'please do not reply to this email',
];

// Patrones y remitentes específicos de rebote de servidor (MTA / Delivery Failure)
const SERVER_BOUNCE_EXACT_EMAILS = [
  'mailer-daemon@host.kroser.com.uy',
];

const SERVER_BOUNCE_EMAIL_PREFIXES = [
  'mailer-daemon@',
  'mail-daemon@',
  'mailerd-daemon@',
  'postmaster@',
  'bounce@',
  'bounces@',
  'bounce-',
  'auto-reply@',
  'mail-delivery@',
];

const SERVER_BOUNCE_SENDER_NAMES = [
  'mailer-daemon',
  'mail delivery subsystem',
  'mail delivery system',
  'postmaster',
];

const SERVER_BOUNCE_SUBJECT_PATTERNS = [
  'mail delivery failed',
  'undelivered mail',
  'delivery status notification',
  'failure notice',
  'returned to sender',
  'returned mail',
  'undeliverable',
  'delivery failure',
];

const SERVER_BOUNCE_BODY_PATTERNS = [
  'mailer-daemon',
  'mail delivery failed',
  'undelivered mail',
  'delivery status notification',
  'failure notice',
  'returned to sender',
  'message could not be delivered',
  'delivery has failed',
  'mailbox unavailable',
  'recipient address rejected',
  'user unknown',
  '550 5.1.1',
  '554 5.7.1',
  '550-5.1.1',
  'host host.kroser.com.uy',
  'host.kroser.com.uy said: 550',
];

/**
 * Extrae datos normalizados de correo electrónico desde un payload de webhook o estructura similar
 */
function extractEmailData(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return { email: '', senderName: '', subject: '', content: '' };
  }

  const message = payload.message || payload || {};
  const sender = message.sender || payload.sender || {};
  const conversation = payload.conversation || {};
  const content = (message.content || payload.content || '').trim();

  let email = '';
  if (sender.email && typeof sender.email === 'string') {
    email = sender.email.trim();
  } else if (message.sender?.email && typeof message.sender.email === 'string') {
    email = message.sender.email.trim();
  } else if (payload.sender?.email && typeof payload.sender.email === 'string') {
    email = payload.sender.email.trim();
  } else if (conversation.meta?.sender?.email && typeof conversation.meta.sender.email === 'string') {
    email = conversation.meta.sender.email.trim();
  } else if (conversation.contact?.email && typeof conversation.contact.email === 'string') {
    email = conversation.contact.email.trim();
  } else if (payload.meta?.sender?.email && typeof payload.meta.sender.email === 'string') {
    email = payload.meta.sender.email.trim();
  }

  const contentAttrs = message.content_attributes || payload.content_attributes || {};
  const emailAttr = contentAttrs.email || {};

  if (!email && emailAttr.from) {
    if (typeof emailAttr.from === 'string') {
      email = emailAttr.from.trim();
    } else if (Array.isArray(emailAttr.from) && emailAttr.from[0]) {
      const first = emailAttr.from[0];
      email = typeof first === 'string' ? first.trim() : (first.address || '').trim();
    }
  }

  if (!email && content) {
    const fromMatch = content.match(/^(?:from|de):\s*<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/im);
    if (fromMatch && fromMatch[1]) {
      email = fromMatch[1].trim();
    }
  }

  let senderName = sender.name || message.sender?.name || payload.sender?.name || conversation.contact?.name || '';
  if (!senderName && emailAttr.from && Array.isArray(emailAttr.from) && emailAttr.from[0]?.name) {
    senderName = emailAttr.from[0].name;
  }

  const subject = emailAttr.subject || contentAttrs.subject || '';

  return {
    email: email.toLowerCase(),
    senderName: String(senderName || '').trim(),
    subject: String(subject || '').trim(),
    content,
  };
}

/**
 * Genera un hash SHA256 corto del texto normalizado
 */
function hashText(str = '') {
  return crypto.createHash('sha256').update(normalize(str)).digest('hex').substring(0, 16);
}

module.exports = {
  /**
   * Evalúa si un texto entrante corresponde a un auto-respondedor, mensaje de ausencia, o menú IVR
   */
  isAutoResponderOrIVR(text = '') {
    if (!text || typeof text !== 'string') return false;
    const cleanText = normalize(text);
    if (!cleanText) return false;

    // 1. Detección de auto-respuesta / fuera de horario
    const autoMatch = AUTO_RESPONDER_PATTERNS.find((pattern) => cleanText.includes(normalize(pattern)));
    if (autoMatch) {
      logger.info('BotLoopDetector: Auto-responder detected', { pattern: autoMatch });
      return { isBot: true, category: 'auto_responder', matchedPattern: autoMatch };
    }

    // 2. Detección de auto-identificación de bot
    const botIdMatch = BOT_IDENTITY_PATTERNS.find((pattern) => cleanText.includes(normalize(pattern)));
    if (botIdMatch) {
      logger.info('BotLoopDetector: Third-party bot identity detected', { pattern: botIdMatch });
      return { isBot: true, category: 'bot_identity', matchedPattern: botIdMatch };
    }

    // 3. Detección de menú IVR explícito
    const ivrIndicator = IVR_INDICATOR_PATTERNS.find((pattern) => cleanText.includes(normalize(pattern)));
    if (ivrIndicator) {
      logger.info('BotLoopDetector: IVR menu indicator detected', { pattern: ivrIndicator });
      return { isBot: true, category: 'ivr_menu', matchedPattern: ivrIndicator };
    }

    // 4. Detección de lista estructurada de opciones numeradas (ej. "1- Ventas\n2- Envíos")
    const optionMatches = text.match(/(?:^|\n)\s*(?:[1-9]\s*[-–.)]|opci[oó]n\s*[1-9]|1️⃣|2️⃣)/gim);
    if (optionMatches && optionMatches.length >= 2) {
      logger.info('BotLoopDetector: Multi-option IVR list detected', { count: optionMatches.length });
      return { isBot: true, category: 'ivr_menu_list', optionCount: optionMatches.length };
    }

    return false;
  },

  /**
   * Determina si se debe suprimir la despedida para evitar espirales de cortesía infinitas.
   * Si el bot ya se despidió en su turno inmediato anterior y el cliente envía un simple
   * "gracias", "a vos", "chau" o similar, no se debe responder con otra despedida.
   */
  shouldSuppressFarewell(history = [], incomingText = '') {
    if (!incomingText || !Array.isArray(history) || history.length === 0) return false;

    const cleanIncoming = normalize(incomingText);
    const words = cleanIncoming.split(/\s+/).filter(Boolean);

    // Si el mensaje incluye intenciones de compra o consultas de stock/precio, no suprimir
    const hasProductInquiry =
      cleanIncoming.includes('precio') ||
      cleanIncoming.includes('stock') ||
      cleanIncoming.includes('cuanto') ||
      cleanIncoming.includes('donde') ||
      cleanIncoming.includes('tenes') ||
      cleanIncoming.includes('tienen') ||
      cleanIncoming.includes('comprar') ||
      cleanIncoming.includes('pedido') ||
      cleanIncoming.includes('catalogo');

    if (hasProductInquiry) return false;

    // Aplica a mensajes de cortesía o agradecimiento de hasta 12 palabras
    const isClosingCourtesy =
      words.length <= 12 &&
      FAREWELL_CLOSING_PATTERNS.some((pat) => cleanIncoming.includes(normalize(pat)));

    if (!isClosingCourtesy) return false;

    // Buscar el último mensaje del asistente en el historial
    let lastAssistantMessage = null;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'assistant') {
        lastAssistantMessage = history[i].content || '';
        break;
      }
    }

    if (!lastAssistantMessage) return false;

    const cleanAssistantMsg = normalize(lastAssistantMessage);
    const assistantAlreadyClosed = ASSISTANT_FAREWELL_SIGNALS.some((signal) =>
      cleanAssistantMsg.includes(normalize(signal))
    );

    if (assistantAlreadyClosed) {
      logger.info('BotLoopDetector: Suppressing farewell loop. Assistant already closed conversation.');
      return true;
    }

    return false;
  },

  /**
   * Detecta si el remitente está enviando exactamente el mismo mensaje repetidas veces
   * (bucle de error o script de prueba en bucle).
   * Si el mismo hash se repite 3 veces consecutivas, se considera un bucle atascado.
   */
  async checkAndTrackRepetition(conversationId, incomingText = '') {
    if (!conversationId || !incomingText) return { isLoop: false };

    const textHash = hashText(incomingText);
    const repetitionKey = `recent_in_msgs:${conversationId}`;

    // Almacenar últimos 4 hashes
    const count = await redis.rpush(repetitionKey, textHash);
    await redis.expire(repetitionKey, 3600); // 1 hora TTL

    if (count >= 3) {
      const recentHashes = await redis.lrange(repetitionKey, -3, -1);
      if (recentHashes.length === 3 && recentHashes.every((h) => h === textHash)) {
        logger.warn('BotLoopDetector: Repetitive message loop detected for conversation', {
          conversationId,
          textHash,
        });
        return { isLoop: true, reason: 'repetitive_message_loop' };
      }
    }

    return { isLoop: false };
  },

  /**
   * Registra e incrementa el conteo de turnos consecutivos del bot para una conversación.
   * Si supera el límite configurado (por defecto 15), dispara el Circuit Breaker.
   */
  async checkAndIncrementTurns(conversationId) {
    if (!conversationId) return { turnCount: 1, isLimitReached: false };

    const maxTurnsConfig = await configuracionRepo.get('bot_max_turns_limit');
    const maxTurns = parseInt(maxTurnsConfig || '15', 10);

    const turnsKey = `bot_turns:${conversationId}`;
    const currentTurns = await redis.incr(turnsKey);
    await redis.expire(turnsKey, 86400); // 24 horas TTL

    const isLimitReached = currentTurns >= maxTurns;

    logger.info('BotLoopDetector: Turn checked', {
      conversationId,
      currentTurns,
      maxTurns,
      isLimitReached,
    });

    return {
      turnCount: currentTurns,
      maxTurns,
      isLimitReached,
    };
  },

  /**
   * Reinicia el conteo de turnos para una conversación cuando un agente humano interviene
   */
  async resetTurns(conversationId) {
    if (!conversationId) return;
    try {
      await redis.del(`bot_turns:${conversationId}`);
      await redis.del(`recent_in_msgs:${conversationId}`);
      logger.info('BotLoopDetector: Turns reset for conversation', { conversationId });
    } catch (err) {
      logger.warn('BotLoopDetector: Error resetting turns', { conversationId, error: err.message });
    }
  },

  /**
   * Extrae datos normalizados de correo electrónico desde un payload o mensaje
   */
  extractEmailData,

  /**
   * Detecta si un correo entrante proviene de una casilla No-Reply (notificaciones automáticas sin respuesta)
   */
  isNoReply(input, optContent = '', optSenderName = '') {
    let email = '';
    let content = '';
    let senderName = '';

    if (input && typeof input === 'object') {
      if (input.email !== undefined) {
        email = (input.email || '').toLowerCase().trim();
        content = input.content || '';
        senderName = input.senderName || '';
      } else {
        const extracted = extractEmailData(input);
        email = extracted.email;
        content = extracted.content;
        senderName = extracted.senderName;
      }
    } else if (typeof input === 'string') {
      email = input.toLowerCase().trim();
      content = optContent || '';
      senderName = optSenderName || '';
    }

    if (!email && !content && !senderName) return false;

    // 1. Coincidencia exacta o por patrón de email (ej: noreply@business-updates.facebook.com)
    if (email) {
      if (NO_REPLY_EXACT_EMAILS.includes(email)) {
        logger.info('BotLoopDetector: Exact No-Reply email address detected', { email });
        return { isNoReply: true, reason: 'noreply_exact_address', email };
      }
      if (NO_REPLY_EMAIL_PREFIXES.some((pre) => email.startsWith(pre))) {
        logger.info('BotLoopDetector: No-Reply email prefix detected', { email });
        return { isNoReply: true, reason: 'noreply_prefix', email };
      }
      if (NO_REPLY_EMAIL_DOMAINS.some((dom) => email.endsWith(`@${dom}`) || email.endsWith(`.${dom}`))) {
        logger.info('BotLoopDetector: No-Reply email domain detected', { email });
        return { isNoReply: true, reason: 'noreply_domain', email };
      }
    }

    // 2. Coincidencia en nombre del remitente
    if (senderName) {
      const cleanSender = normalize(senderName);
      if (NO_REPLY_SENDER_NAMES.some((name) => cleanSender.includes(normalize(name)))) {
        logger.info('BotLoopDetector: No-Reply sender name detected', { senderName });
        return { isNoReply: true, reason: 'noreply_sender_name', senderName };
      }
    }

    // 3. Indicador explícito en cuerpo o cabeceras
    if (content) {
      const cleanContent = normalize(content);
      const matchedPattern = NO_REPLY_BODY_PATTERNS.find((pattern) => cleanContent.includes(normalize(pattern)));
      if (matchedPattern) {
        logger.info('BotLoopDetector: No-Reply indicator detected in email body/headers', { matchedPattern });
        return { isNoReply: true, reason: 'noreply_body_indicator', matchedPattern };
      }
    }

    return false;
  },

  /**
   * Detecta si un correo entrante corresponde a un rebote del servidor (MTA / Delivery Failed / Mailer-Daemon)
   */
  isServerBounce(input, optContent = '', optSenderName = '', optSubject = '') {
    let email = '';
    let content = '';
    let senderName = '';
    let subject = '';

    if (input && typeof input === 'object') {
      if (input.email !== undefined) {
        email = (input.email || '').toLowerCase().trim();
        content = input.content || '';
        senderName = input.senderName || '';
        subject = input.subject || '';
      } else {
        const extracted = extractEmailData(input);
        email = extracted.email;
        content = extracted.content;
        senderName = extracted.senderName;
        subject = extracted.subject;
      }
    } else if (typeof input === 'string') {
      email = input.toLowerCase().trim();
      content = optContent || '';
      senderName = optSenderName || '';
      subject = optSubject || '';
    }

    if (!email && !content && !senderName && !subject) return false;

    // 1. Coincidencia exacta o por patrón en email (ej: mailer-daemon@host.kroser.com.uy)
    if (email) {
      if (SERVER_BOUNCE_EXACT_EMAILS.includes(email)) {
        logger.warn('BotLoopDetector: Exact server bounce email address detected', { email });
        return { isBounce: true, reason: 'server_bounce_exact_address', email };
      }
      if (SERVER_BOUNCE_EMAIL_PREFIXES.some((pre) => email.startsWith(pre))) {
        logger.warn('BotLoopDetector: Server bounce email prefix detected', { email });
        return { isBounce: true, reason: 'server_bounce_prefix', email };
      }
      if (email.includes('mailer-daemon') || (email.includes('daemon') && email.includes('kroser.com.uy'))) {
        logger.warn('BotLoopDetector: Server bounce daemon keyword in email', { email });
        return { isBounce: true, reason: 'server_bounce_daemon_email', email };
      }
    }

    // 2. Coincidencia en nombre de remitente (MTA / Subsistema de correo)
    if (senderName) {
      const cleanSender = normalize(senderName);
      if (SERVER_BOUNCE_SENDER_NAMES.some((name) => cleanSender.includes(normalize(name)))) {
        logger.warn('BotLoopDetector: Server bounce sender name detected', { senderName });
        return { isBounce: true, reason: 'server_bounce_sender_name', senderName };
      }
    }

    // 3. Coincidencia en asunto del email
    if (subject) {
      const cleanSubject = normalize(subject);
      const matchedSubject = SERVER_BOUNCE_SUBJECT_PATTERNS.find((pattern) => cleanSubject.includes(normalize(pattern)));
      if (matchedSubject) {
        logger.warn('BotLoopDetector: Server bounce detected by subject', { subject, matchedSubject });
        return { isBounce: true, reason: 'server_bounce_subject', matchedSubject };
      }
    }

    // 4. Coincidencia en cuerpo del email (delivery report)
    if (content) {
      const cleanContent = normalize(content);
      const matchedBody = SERVER_BOUNCE_BODY_PATTERNS.find((pattern) => cleanContent.includes(normalize(pattern)));
      if (matchedBody) {
        logger.warn('BotLoopDetector: Server bounce detected by body pattern', { matchedBody });
        return { isBounce: true, reason: 'server_bounce_body_pattern', matchedBody };
      }
    }

    return false;
  },
};

/**
 * Intent Detector and Emotion Analyzer for KroserBot
 */

const GREETING_PATTERNS = [
  'hola', 'buenas', 'buen dia', 'buenos dias', 'buenas tardes', 'buenas noches',
  'que tal', 'hola buenas', 'hola que tal', 'buenas como va', 'hola como estas',
  'estimados', 'hola kroser', 'opa', 'saludos',
];

const FAREWELL_PATTERNS = [
  'muchas gracias', 'gracias', 'chau', 'hasta luego', 'nos vemos', 'listo gracias',
  'perfecto gracias', 'muchas gracias por la atencion', 'impecable muchas gracias',
  'muchas gracias hasta luego', 'gracias por todo', 'excelente gracias',
];

const CANCELLATION_PATTERNS = [
  'ya no lo quiero', 'cancelar mi pedido', 'cancela el pedido', 'cancelar pedido',
  'no quiero mas', 'dejo sin efecto', 'dejalo sin efecto', 'dejar sin efecto mi compra', 'dejar sin efecto el pedido',
  'anular pedido', 'anulen el pedido', 'anular mi pedido', 'no me interesa mas', 'olvidate del pedido', 'dejalo asi',
  'cancelen el pedido', 'deseo cancelar la compra',
];

const TRACKING_PATTERNS = [
  'como viene mi pedido', 'estado de mi pedido', 'estado de mi compra', 'estado del pedido',
  'cuando llega mi pedido', 'cuando me entregan', 'seguimiento de pedido', 'numero de seguimiento',
  'rastreo de pedido', 'donde esta mi pedido', 'ya despacharon', 'ya enviaron mi pedido',
  'saber de mi pedido', 'mi pedido llego', 'estado de la orden', 'consultar pedido',
  'como va mi pedido', 'como esta mi pedido', 'informacion de mi pedido', 'seguimiento',
];

const COMPLAINT_PATTERNS = [
  'reclamo', 'factura con error', 'queja', 'es un desastre', 'inaceptable',
  'pesimo servicio', 'defectuoso', 'vino roto', 'cobro mal', 'me cobraron de mas',
  'garantia rota', 'falla de fabrica', 'producto roto', 'vino fallado', 'vino fallada',
  'no funciona', 'no me funciona', 'no prende', 'no arranca', 'vino danado', 'vino danada',
  'quiero devolver', 'quiero hacer una devolucion', 'solicitar devolucion', 'hacer un reclamo', 'hacer una queja',
  'me vino roto', 'me vino fallado', 'hacer valer garantia', 'reclamo de garantia', 'garantia por falla',
  'atendieron mal', 'pesima atencion', 'tengo un problema con', 'el producto no anda', 'no me anda',
];

const GREETING_WORDS = new Set([
  'hola', 'buenas', 'buen', 'buenos', 'dia', 'dias', 'tarde', 'tardes', 'noche', 'noches',
  'que', 'tal', 'como', 'estas', 'esta', 'va', 'kroser', 'saludos', 'opa',
  'estimados', 'estimado', 'estimada', 'gente', 'todos', 'equipo'
]);

const FAREWELL_WORDS = new Set([
  'muchas', 'gracias', 'chau', 'hasta', 'luego', 'nos', 'vemos', 'listo',
  'perfecto', 'excelente', 'impecable', 'por', 'todo', 'la', 'atencion',
  'muy', 'amable', 'buen', 'fin', 'de', 'semana', 'igualmente', 'saludos',
  'pase', 'bien', 'kroser', 'genial', 'gracia'
]);

const REJECTION_PATTERNS = [
  'no me sirve', 'no me sirven', 'no me sirve ninguna', 'ninguna me sirve',
  'no quiero esa', 'no quiero esa marca', 'no quiero eso', 'no me interesa esa',
  'no tienen lo que busco', 'no es lo que busco', 'no es lo que necesito',
  'no tienen otra marca', 'no tienen otra cosa', 'no tienen otro modelo',
  'ninguna de esas', 'ninguno de esos', 'no era eso', 'deja nomas',
  'dejalo ahi', 'no gracias ninguna', 'busco otra marca', 'no quiero ninguno',
  'no quiero productos', 'no quiero producto', 'no quiero comprar nada',
];

const URGENCY_PATTERNS = [
  'urgente', 'para ya', 'cuanto antes', 'es para ahora', 'emergencia',
  'lo necesito urgente', 'urgentemente', 'apurado', 'necesito hoy mismo',
];

/**
 * Returns current hour in Uruguay (UTC-3)
 */
function getUruguayHour() {
  const now = new Date();
  const uruguayTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Montevideo' }));
  return uruguayTime.getHours();
}

/**
 * Get time-of-day greeting (Formal style)
 */
function getTimeOfDayGreeting(customerName = '') {
  const hour = getUruguayHour();
  const nameSuffix = customerName ? ` ${customerName}` : '';

  if (hour >= 6 && hour < 12) {
    const morningGreetings = [
      `¡Buenos días${nameSuffix}! Bienvenido a Kroser. ¿En qué lo podemos asesorar hoy?`,
      `¡Muy buenos días${nameSuffix}! Gracias por comunicarse con Kroser. ¿Qué producto o consulta tiene hoy?`,
      `¡Buenos días${nameSuffix}! En Kroser estamos a las órdenes. ¿En qué le podemos ayudar?`,
    ];
    return morningGreetings[Math.floor(Math.random() * morningGreetings.length)];
  } else if (hour >= 12 && hour < 19) {
    const afternoonGreetings = [
      `¡Buenas tardes${nameSuffix}! Bienvenido a Kroser. ¿En qué lo podemos ayudar hoy?`,
      `¡Muy buenas tardes${nameSuffix}! Gracias por comunicarse con Kroser. ¿Qué producto o artículo está buscando?`,
      `¡Buenas tardes${nameSuffix}! Estamos a su disposición en Kroser. ¿En qué lo podemos asesorar?`,
    ];
    return afternoonGreetings[Math.floor(Math.random() * afternoonGreetings.length)];
  } else {
    const eveningGreetings = [
      `¡Buenas noches${nameSuffix}! Gracias por comunicarse con Kroser. ¿En qué le podemos asesorar?`,
      `¡Buenas noches${nameSuffix}! Bienvenido a Kroser. ¿Qué producto o información precisa consultar?`,
      `¡Buenas noches${nameSuffix}! Estamos a las órdenes en Kroser. ¿En qué le podemos colaborar?`,
    ];
    return eveningGreetings[Math.floor(Math.random() * eveningGreetings.length)];
  }
}

/**
 * Get natural formal farewell
 */
function getFormalFarewell() {
  const uruDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Montevideo' }));
  const day = uruDate.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday
  const hour = uruDate.getHours();

  const isWeekendFarewell = (day === 5 && hour >= 14) || day === 6 || day === 0;

  if (isWeekendFarewell) {
    const weekendFarewells = [
      'Muchas gracias por comunicarse con Kroser. ¡Que pase un excelente fin de semana! Quedamos a las órdenes por cualquier otra consulta.',
      '¡A las órdenes! Gracias por contactarse con Kroser. ¡Que disfrute su fin de semana!',
      'Ha sido un placer atenderlo. ¡Muy buen fin de semana y a las órdenes siempre en Kroser!',
    ];
    return weekendFarewells[Math.floor(Math.random() * weekendFarewells.length)];
  }

  const farewells = [
    'Muchas gracias por comunicarse con Kroser. ¡Que tenga un excelente día! Quedamos a las órdenes por cualquier otra consulta.',
    '¡A las órdenes! Gracias por contactarse con Kroser. Que pase muy bien.',
    'Ha sido un placer atenderlo. Por cualquier otra consulta o pedido, estamos a su completa disposición en Kroser.',
  ];
  return farewells[Math.floor(Math.random() * farewells.length)];
}

/**
 * Normalize string (removes diacritics and special punctuation)
 */
function normalizeText(str = '') {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
}

/**
 * Analyzes message to detect intent, emotion, and whether it's pure greeting/farewell
 */
function detectIntent(text = '') {
  const cleanText = normalizeText(text);
  const words = cleanText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // Normalized pattern check
  const isCancellation = CANCELLATION_PATTERNS.some((pattern) => cleanText.includes(normalizeText(pattern)));
  const isTracking = TRACKING_PATTERNS.some((pattern) => cleanText.includes(normalizeText(pattern))) || /#\s*[0-9]{1,8}/.test(text);
  const isComplaint = COMPLAINT_PATTERNS.some((pattern) => cleanText.includes(normalizeText(pattern)));
  const isRejection = REJECTION_PATTERNS.some((pattern) => cleanText.includes(normalizeText(pattern)));
  const isUrgent = URGENCY_PATTERNS.some((pattern) => cleanText.includes(normalizeText(pattern)));

  // Greeting Check
  const matchedGreeting = GREETING_PATTERNS.find((pattern) => cleanText.includes(normalizeText(pattern)));
  const hasGreeting = Boolean(matchedGreeting);

  // Pure Greeting: Must match a greeting AND all tokens must be greeting pleasantries
  const isPureGreeting =
    hasGreeting &&
    words.length > 0 &&
    words.every((w) => GREETING_WORDS.has(w)) &&
    !isTracking &&
    !isCancellation &&
    !isComplaint;

  // Farewell Check
  const matchedFarewell = FAREWELL_PATTERNS.find((pattern) => cleanText.includes(normalizeText(pattern)));
  const hasFarewell = Boolean(matchedFarewell);

  // Pure Farewell: Must match a farewell AND all tokens must be farewell pleasantries
  const isPureFarewell =
    hasFarewell &&
    words.length > 0 &&
    words.every((w) => FAREWELL_WORDS.has(w)) &&
    !isTracking &&
    !isCancellation &&
    !isComplaint;

  // Emotion determination
  let emotion = 'neutral';
  if (isComplaint) {
    emotion = 'frustrado';
  } else if (isUrgent) {
    emotion = 'apurado';
  } else if (hasGreeting || hasFarewell) {
    emotion = 'amable';
  }

  let primaryIntent = 'consulta_general';
  if (isCancellation) primaryIntent = 'cancelacion';
  else if (isTracking) primaryIntent = 'tracking_pedido';
  else if (isComplaint) primaryIntent = 'reclamo';
  else if (isRejection) primaryIntent = 'rechazo_producto';
  else if (isPureGreeting) primaryIntent = 'saludo';
  else if (isPureFarewell) primaryIntent = 'despedida';
  else if (isUrgent) primaryIntent = 'urgencia';

  return {
    intent: primaryIntent,
    emotion,
    hasGreeting,
    isPureGreeting,
    hasFarewell,
    isPureFarewell,
    isCancellation,
    isTracking,
    isComplaint,
    isRejection,
    isUrgent,
    getGreetingMessage: (name) => getTimeOfDayGreeting(name),
    getFarewellMessage: () => getFormalFarewell(),
  };
}

module.exports = {
  detectIntent,
  getTimeOfDayGreeting,
  getFormalFarewell,
  getUruguayHour,
};

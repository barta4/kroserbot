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
  'no quiero mas', 'dejo sin efecto', 'dejalo sin efecto', 'sin efecto', 'anular pedido', 'anulen el pedido',
  'anular mi pedido', 'no me interesa mas', 'olvidate del pedido', 'dejalo asi',
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
  'garantia rota', 'falla de fabrica', 'producto roto',
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
  const isUrgent = URGENCY_PATTERNS.some((pattern) => cleanText.includes(normalizeText(pattern)));

  // Greeting Check
  const matchedGreeting = GREETING_PATTERNS.find((pattern) => cleanText.includes(normalizeText(pattern)));
  const hasGreeting = Boolean(matchedGreeting);

  // Pure Greeting
  const isPureGreeting = hasGreeting && wordCount <= 4 && !cleanText.includes('precio') && !cleanText.includes('stock') && !cleanText.includes('taladro') && !cleanText.includes('pintura') && !cleanText.includes('donde') && !cleanText.includes('cuanto') && !isTracking;

  // Farewell Check
  const matchedFarewell = FAREWELL_PATTERNS.find((pattern) => cleanText.includes(normalizeText(pattern)));
  const hasFarewell = Boolean(matchedFarewell);
  const isPureFarewell = hasFarewell && wordCount <= 6 && !cleanText.includes('pedido') && !cleanText.includes('comprar') && !cleanText.includes('precio') && !isTracking;

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

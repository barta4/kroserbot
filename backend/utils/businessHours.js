/**
 * Business Hours & Out-of-Hours Management for Kroserbot
 * Timezone: America/Montevideo (Uruguay, UTC-3)
 * Handles Meta 24-hour customer care window compliance for WhatsApp and Instagram.
 */

/**
 * Extracts exact temporal components in Uruguay timezone
 */
function getUruguayDate(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Montevideo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const partMap = {};
  for (const part of parts) {
    partMap[part.type] = part.value;
  }

  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = weekdayMap[partMap.weekday] !== undefined ? weekdayMap[partMap.weekday] : 0;
  let hour = parseInt(partMap.hour, 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(partMap.minute, 10);

  return {
    year: parseInt(partMap.year, 10),
    month: parseInt(partMap.month, 10),
    day: parseInt(partMap.day, 10),
    dayOfWeek, // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
  };
}

/**
 * Parses "HH:MM" into total minutes from midnight
 */
function parseTimeToMinutes(timeStr, defaultMinutes) {
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) {
    return defaultMinutes;
  }
  const [h, m] = timeStr.split(':').map((s) => parseInt(s, 10));
  if (isNaN(h) || isNaN(m)) return defaultMinutes;
  return h * 60 + m;
}

/**
 * Determines whether current time is within human business hours
 */
function isWithinBusinessHours(date = new Date(), config = {}) {
  const uru = getUruguayDate(date);
  const { dayOfWeek, totalMinutes, hour, minute } = uru;

  const weekdayStart = parseTimeToMinutes(config.business_hours_weekday_start, 9 * 60);
  const weekdayEnd = parseTimeToMinutes(config.business_hours_weekday_end, 18 * 60);

  const satEnabled =
    config.business_hours_saturday_enabled !== 'false' &&
    config.business_hours_saturday_enabled !== false;
  const satStart = parseTimeToMinutes(config.business_hours_saturday_start, 9 * 60);
  const satEnd = parseTimeToMinutes(config.business_hours_saturday_end, 13 * 60);

  // Sunday: Closed for human attention
  if (dayOfWeek === 0) {
    return {
      isWithin: false,
      reason: 'weekend',
      dayOfWeek,
      hour,
      minute,
    };
  }

  // Saturday
  if (dayOfWeek === 6) {
    if (!satEnabled) {
      return {
        isWithin: false,
        reason: 'weekend',
        dayOfWeek,
        hour,
        minute,
      };
    }
    const isOpen = totalMinutes >= satStart && totalMinutes < satEnd;
    return {
      isWithin: isOpen,
      reason: isOpen ? 'open' : (totalMinutes >= satEnd ? 'weekend' : 'out_of_hours'),
      dayOfWeek,
      hour,
      minute,
    };
  }

  // Weekdays: Monday to Friday
  const isOpen = totalMinutes >= weekdayStart && totalMinutes < weekdayEnd;
  const isWeekendTransition = dayOfWeek === 5 && totalMinutes >= weekdayEnd;
  return {
    isWithin: isOpen,
    reason: isOpen ? 'open' : (isWeekendTransition ? 'weekend' : 'out_of_hours'),
    dayOfWeek,
    hour,
    minute,
  };
}

/**
 * Returns human-readable description of when human support resumes
 */
function getNextBusinessDayString(date = new Date(), config = {}) {
  const uru = getUruguayDate(date);
  const { dayOfWeek, totalMinutes } = uru;

  const weekdayStartStr = config.business_hours_weekday_start || '09:00';
  const weekdayStart = parseTimeToMinutes(weekdayStartStr, 9 * 60);
  const weekdayEnd = parseTimeToMinutes(config.business_hours_weekday_end, 18 * 60);

  const satEnabled =
    config.business_hours_saturday_enabled !== 'false' &&
    config.business_hours_saturday_enabled !== false;
  const satStartStr = config.business_hours_saturday_start || '09:00';
  const satStart = parseTimeToMinutes(satStartStr, 9 * 60);
  const satEnd = parseTimeToMinutes(config.business_hours_saturday_end, 13 * 60);

  // Sunday
  if (dayOfWeek === 0) {
    return `el lunes a partir de las ${weekdayStartStr} hs`;
  }

  // Saturday
  if (dayOfWeek === 6) {
    if (satEnabled && totalMinutes < satStart) {
      return `hoy sábado a partir de las ${satStartStr} hs`;
    }
    return `el lunes a partir de las ${weekdayStartStr} hs`;
  }

  // Friday
  if (dayOfWeek === 5) {
    if (totalMinutes >= weekdayEnd) {
      if (satEnabled) {
        return `mañana sábado a partir de las ${satStartStr} hs`;
      }
      return `el lunes a partir de las ${weekdayStartStr} hs`;
    }
    if (totalMinutes < weekdayStart) {
      return `hoy a partir de las ${weekdayStartStr} hs`;
    }
    return `hoy hasta las ${config.business_hours_weekday_end || '18:00'} hs`;
  }

  // Monday to Thursday
  if (totalMinutes >= weekdayEnd) {
    return `mañana a partir de las ${weekdayStartStr} hs`;
  }
  if (totalMinutes < weekdayStart) {
    return `hoy a partir de las ${weekdayStartStr} hs`;
  }

  return `hoy hasta las ${config.business_hours_weekday_end || '18:00'} hs`;
}

/**
 * Returns tailored out-of-hours message with Meta 24-hour policy advisory
 */
function getOutHoursMessage({ channel = '', nextBusinessDay = '', alternativeEmail = 'atencion@kroser.com.uy', customTemplate = '' } = {}) {
  const normChannel = String(channel || '').toLowerCase();
  const isMeta = normChannel.includes('whatsapp') || normChannel.includes('instagram');

  if (customTemplate && customTemplate.trim()) {
    return customTemplate
      .replace(/\{nextBusinessDay\}/g, nextBusinessDay)
      .replace(/\{alternativeEmail\}/g, alternativeEmail);
  }

  if (isMeta) {
    return `¡Hola! En este momento nuestro equipo de atención humana se encuentra fuera de horario comercial (horario de atención: lunes a viernes de 09:00 a 18:00 hs y sábados de 09:00 a 13:00 hs).

⚠️ IMPORTANTE: Por políticas de privacidad y mensajería de WhatsApp e Instagram, la ventana de conversación se cierra si transcurren más de 24 horas. Para que un asesor humano pueda responderle directamente, por favor vuelva a escribirnos ${nextBusinessDay}.

✉️ Si prefiere no aguardar, puede enviarnos su consulta detallada por correo a ${alternativeEmail} y le responderemos por esa vía a primera hora.

Mientras tanto, yo sigo aquí a su completa disposición para ayudarle a consultar productos, precios en catálogo, disponibilidad de stock o sucursales abiertas.`;
  }

  return `¡Hola! En este momento nuestro equipo de atención personalizada se encuentra fuera del horario comercial. Retomaremos la atención humana ${nextBusinessDay}.

Su consulta ha quedado registrada en nuestro sistema para que un asesor le responda a primera hora.

✉️ También puede escribirnos a ${alternativeEmail}.

Mientras tanto, yo sigo disponible aquí en el chat para ayudarle a consultar artículos, precios en catálogo o datos de sucursales físicas.`;
}

/**
 * Generates prompt directive for the LLM to understand current time and human availability
 */
function getTemporalContextPrompt(date = new Date(), config = {}) {
  const uru = getUruguayDate(date);
  const status = isWithinBusinessHours(date, config);
  const daysNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const dayName = daysNames[uru.dayOfWeek];
  const timeFormatted = `${String(uru.hour).padStart(2, '0')}:${String(uru.minute).padStart(2, '0')}`;
  const nextBiz = getNextBusinessDayString(date, config);

  if (status.isWithin) {
    return `CONTEXTO TEMPORAL Y HORARIOS (URUGUAY UTC-3):
- Momento: ${dayName} ${timeFormatted} hs.
- Estado: HORARIO COMERCIAL HÁBIL ABIERTO. Asesores humanos disponibles para derivaciones.`;
  }

  return `CONTEXTO TEMPORAL Y HORARIOS (URUGUAY UTC-3):
- Momento: ${dayName} ${timeFormatted} hs.
- Estado: FUERA DE HORARIO COMERCIAL / ATENCIÓN HUMANA NO DISPONIBLE. Atención humana retoma ${nextBiz}.
- REGLA CRÍTICA: NUNCA prometa ni asegure que un asesor humano atenderá de inmediato. Si piden persona o reclamo, aclare que la atención humana retoma ${nextBiz}.`;
}

module.exports = {
  getUruguayDate,
  parseTimeToMinutes,
  isWithinBusinessHours,
  getNextBusinessDayString,
  getOutHoursMessage,
  getTemporalContextPrompt,
};

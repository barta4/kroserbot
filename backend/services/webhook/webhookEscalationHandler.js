const redis = require('../../config/redis');
const logger = require('../../config/logger');
const configuracionRepo = require('../../repositories/configuracionRepository');
const conversacionesRepo = require('../../repositories/conversacionesRepository');
const chatwootService = require('../chatwoot/chatwootService');
const derivationNoteService = require('../chatwoot/derivationNoteService');
const emailService = require('../email/emailService');
const debounceService = require('./debounceService');
const autoResolveService = require('../chatwoot/autoResolveService');
const businessHours = require('../../utils/businessHours');

const HUMAN_ACTIVE_TTL = 86400; // 24 hours

/**
 * Handles human escalation / derivation (both from guardrails and LLM DERIVAR:[area] signals).
 */
async function handleEscalation({
  area = 'info',
  reason = 'Derivación solicitada',
  sender = {},
  conversationId,
  accountId,
  channel = 'whatsapp',
  history = [],
  ragContextStr = '',
  actionName = 'human_escalation',
}) {
  const normArea = (area || 'info').toLowerCase();

  const bConfig = await configuracionRepo.getMultiple([
    `assignee_id_${normArea}`,
    'derivation_agent_id',
    'chatwoot_default_assignee_id',
    'derivation_label',
    'msg_derivacion',
    'business_hours_weekday_start',
    'business_hours_weekday_end',
    'business_hours_saturday_enabled',
    'business_hours_saturday_start',
    'business_hours_saturday_end',
    'contact_alternative_email',
    'msg_fuera_de_horario',
  ]);

  const areaAssignee = bConfig[`assignee_id_${normArea}`];
  const defaultAssignee = bConfig.derivation_agent_id || bConfig.chatwoot_default_assignee_id;
  const rawAssignee = areaAssignee || defaultAssignee || 1;
  const assigneeId = Number(rawAssignee) || rawAssignee;

  const derivationLabel = (bConfig.derivation_label && bConfig.derivation_label.trim()) || 'derivar';
  const defaultMsgDerivacion =
    bConfig.msg_derivacion ||
    'Le estamos derivando con un asesor especializado que podrá brindarle una atención personalizada. Por favor aguarde un instante.';

  const hoursStatus = businessHours.isWithinBusinessHours(new Date(), bConfig);
  const nextBusinessDay = businessHours.getNextBusinessDayString(new Date(), bConfig);
  const isOutOfHours = !hoursStatus.isWithin;

  let msgToSend = defaultMsgDerivacion;
  if (normArea === 'administracion' && !msgToSend.includes('2508 3100')) {
    msgToSend += ' También puede comunicarse directamente con nuestra atención al cliente a los teléfonos 2508 3100 / 2509 7508 (WhatsApp 094 985 189 / 095 141 194).';
  }
  if (isOutOfHours) {
    msgToSend = businessHours.getOutHoursMessage({
      channel,
      nextBusinessDay,
      alternativeEmail: bConfig.contact_alternative_email || 'atencion@kroser.com.uy',
      customTemplate: bConfig.msg_fuera_de_horario,
    });
  }

  // Silence the bot ONLY if within business hours (human is ready to respond immediately).
  // If out-of-hours / weekend, do NOT silence the bot permanently so customer can keep asking about products/catalog!
  if (conversationId && !isOutOfHours) {
    await redis.set(`human_active:${conversationId}`, '1', 'EX', HUMAN_ACTIVE_TTL);
    debounceService.cancel(conversationId);
    await redis.del(`conv_buffer:${conversationId}`);
    autoResolveService.cancelScheduledResolve(conversationId);
  } else if (conversationId && isOutOfHours) {
    debounceService.cancel(conversationId);
    await redis.del(`conv_buffer:${conversationId}`);
    autoResolveService.cancelScheduledResolve(conversationId);
  }

  await chatwootService.toggleTypingStatus(accountId, conversationId, 'off');

  // Assign in Chatwoot only if within business hours so bot is not silenced during off-hours/weekends
  if (!isOutOfHours) {
    await chatwootService.assignAgent(accountId, conversationId, assigneeId);
  }
  await chatwootService.sendMessage(accountId, conversationId, msgToSend);
  await conversacionesRepo.logMessage(conversationId, msgToSend, 'assistant');

  // Add derivation label (default 'derivar') + out-of-hours tags in Chatwoot
  const labels = [derivationLabel];
  if (isOutOfHours) {
    labels.push('fuera-de-horario');
    if (hoursStatus.reason === 'weekend') labels.push('fin-de-semana');
  }
  await chatwootService.addLabels(accountId, conversationId, labels);

  // Generate executive summary & action plan as private note for agent
  const noteReason = isOutOfHours
    ? `Derivación fuera de horario (${hoursStatus.reason.toUpperCase()}). Atención humana retoma ${nextBusinessDay}. Motivo: ${reason}`
    : reason;

  await derivationNoteService.generateAndSendDerivationNote({
    accountId,
    conversationId,
    area: normArea,
    sender,
    reason: noteReason,
    history,
    ragContextStr,
  });

  // Send email alert to internal area
  await emailService.sendDerivationAlert({
    area: normArea,
    clienteNombre: sender.name,
    clienteTelefono: sender.phone_number,
    clienteMail: sender.email,
    conversationId,
    motivo: isOutOfHours
      ? `[FUERA DE HORARIO - ${hoursStatus.reason.toUpperCase()}] ${reason}`
      : reason,
  });

  return {
    status: 'processed',
    action: actionName,
    area: normArea,
    isOutOfHours,
    reason: hoursStatus.reason,
    msgToSend,
  };
}

module.exports = {
  handleEscalation,
};

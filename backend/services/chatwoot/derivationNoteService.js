const chatwootService = require('./chatwootService');
const llmService = require('../llm/llmService');
const logger = require('../../config/logger');

module.exports = {
  /**
   * Generates an executive summary and recommended action plan for the human agent,
   * then posts it as a Private Note in Chatwoot.
   *
   * @param {Object} params
   * @param {string|number} params.accountId
   * @param {string|number} params.conversationId
   * @param {string} params.area - Department receiving the conversation (ventas, taller, etc.)
   * @param {Object} params.sender - Client info
   * @param {string} params.reason - Primary reason for escalation
   * @param {Array} params.history - Conversation history messages
   * @param {string} params.ragContextStr - RAG products/stores context if available
   */
  async generateAndSendDerivationNote({
    accountId,
    conversationId,
    area = 'info',
    sender = {},
    reason = '',
    history = [],
    ragContextStr = '',
  }) {
    if (!conversationId) return null;

    const clientName = sender.name || 'No especificado';
    const clientPhone = sender.phone_number || 'No registrado';
    const clientEmail = sender.email || 'No registrado';
    const areaName = String(area).toUpperCase();

    logger.info('Generating derivation private note for agent', {
      conversationId,
      area: areaName,
      client: clientName,
    });

    let noteBody = '';

    // 1. Try AI-generated summary and action plan
    try {
      const systemPrompt = `Sos el asistente de soporte interno para agentes de Kroser Uruguay (ferretería, pinturas y herramientas).
Tu tarea es generar una NOTA INTERNA DE DERIVACIÓN (Private Note) para el asesor humano del área de ${areaName} que atenderá esta conversación.

Genera una nota estructurada, directa y accionable con el siguiente formato exacto en Markdown:

📋 **RESUMEN DE LA CONVERSACIÓN**:
• [Síntesis breve en 2-3 viñetas de lo que el cliente consultó, productos o servicios de interés y qué se le informó]

🚨 **MOTIVO DE DERIVACIÓN**:
• [Por qué requiere atención humana en el área de ${areaName}]

💡 **PLAN DE ACCIÓN SUGERIDO PARA EL ASESOR**:
1. [Paso 1 concreto y accionable para resolver rápido la consulta]
2. [Paso 2 concreto y accionable]
3. [Paso 3 concreto y accionable]

Reglas:
- Sé sumamente sintético, conciso y profesional.
- No incluyas saludos ni despedidas (es una nota interna de trabajo para el CRM).
${ragContextStr ? `\nContexto de productos de catálogo consultados:\n${ragContextStr.substring(0, 800)}` : ''}`;

      const userMessages = history.length > 0
        ? history.map((m) => ({ role: m.role || 'user', content: m.content || '' }))
        : [{ role: 'user', content: reason || 'Consulta general' }];

      const aiReply = await llmService.generateResponse(systemPrompt, userMessages, {
        temperature: 0.2,
      });

      // Ensure the AI response actually looks like a summary and not a generic greeting
      if (aiReply && (aiReply.includes('RESUMEN') || aiReply.includes('PLAN DE ACCIÓN') || aiReply.includes('•'))) {
        noteBody = aiReply.trim();
      }
    } catch (err) {
      logger.warn('LLM derivation note generation failed, using deterministic fallback', {
        error: err.message,
        conversationId,
      });
    }

    // 2. Deterministic Fallback if LLM failed or produced empty/invalid output
    if (!noteBody) {
      const userQueries = history
        .filter((m) => m.role === 'user')
        .slice(-3)
        .map((m) => m.content)
        .join(' | ') || reason || 'Consulta general del cliente';

      noteBody = `📋 **RESUMEN DE LA CONVERSACIÓN**:
• El cliente se contactó consultando sobre: "${userQueries.substring(0, 200)}"
• La consulta requiere atención directa y especializada por parte del equipo de ${areaName}.

🚨 **MOTIVO DE DERIVACIÓN**:
• ${reason || `Gestión correspondiente al departamento de ${areaName}.`}

💡 **PLAN DE ACCIÓN SUGERIDO PARA EL ASESOR**:
1. Revisar los últimos mensajes del cliente para verificar el requerimiento específico.
2. Verificar stock, cotización especial o políticas de entrega en el sistema interno de Kroser.
3. Contactar al cliente presentándose como asesor de ${areaName} para dar resolución definitiva.`;
    }

    // 3. Assemble complete formatted Private Note
    const fullNote = `🤖 **RESUMEN DE DERIVACIÓN — KROSERBOT AI**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 **Cliente**: ${clientName} | 📞 **Tel**: ${clientPhone} | ✉️ **Email**: ${clientEmail}
🏢 **Área Asignada**: ${areaName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${noteBody}`;

    // 4. Send as Private Note (private: true) in Chatwoot
    try {
      const result = await chatwootService.addPrivateNote(accountId, conversationId, fullNote);
      logger.info('Derivation private note posted successfully to Chatwoot', {
        conversationId,
        area: areaName,
      });
      return { success: true, note: fullNote, result };
    } catch (err) {
      logger.error('Failed to post derivation private note to Chatwoot', {
        conversationId,
        error: err.message,
      });
      return { success: false, error: err.message };
    }
  },
};

const redis = require('../../config/redis');
const configuracionRepo = require('../../repositories/configuracionRepository');
const conversacionesRepo = require('../../repositories/conversacionesRepository');
const ragService = require('../embeddings/ragService');
const llmService = require('../llm/llmService');
const chatwootService = require('../chatwoot/chatwootService');
const emailService = require('../email/emailService');
const pedidosService = require('../pedidos/pedidosService');

const IDEMPOTENCY_TTL = 3600; // 1 hour

module.exports = {
  async processWebhookEvent(payload) {
    const correlationId = `conv_${payload.conversation?.id || 'unknown'}_${Date.now()}`;
    console.log(`[Webhook ${correlationId}] Processing event: ${payload.event}`);

    // 1. Event Shield: Only handle message_created
    if (payload.event !== 'message_created') {
      console.log(`[Webhook ${correlationId}] Ignored event '${payload.event}' (not message_created)`);
      return { status: 'ignored', reason: 'event_type_not_handled' };
    }

    const message = payload.message || payload;
    const conversation = payload.conversation || {};
    const messageId = message.id;
    const conversationId = conversation.id || payload.conversation_id;
    const accountId = payload.account?.id || conversation.account_id || 1;
    const sender = message.sender || {};
    const content = (message.content || '').trim();

    // 2. Idempotency Check: Dedup by message_id
    if (messageId) {
      const dedupKey = `msg_processed:${messageId}`;
      const alreadyProcessed = await redis.get(dedupKey);
      if (alreadyProcessed) {
        console.log(`[Webhook ${correlationId}] Ignored duplicate messageId: ${messageId}`);
        return { status: 'ignored', reason: 'duplicate_message' };
      }
      await redis.set(dedupKey, '1', 'EX', IDEMPOTENCY_TTL);
    }

    // 3. Filter Outgoing / Bot messages (avoid infinite loop)
    if (message.message_type === 'outgoing' || sender.type === 'agent' || sender.type === 'bot') {
      console.log(`[Webhook ${correlationId}] Ignored outgoing/agent message`);
      return { status: 'ignored', reason: 'bot_or_agent_message' };
    }

    // 4. Mailer Daemon / Bounce Filter
    if (
      content.toLowerCase().includes('mailer-daemon') ||
      content.toLowerCase().includes('mail delivery failed') ||
      content.toLowerCase().includes('undelivered mail')
    ) {
      console.log(`[Webhook ${correlationId}] Ignored bounce email message`);
      return { status: 'ignored', reason: 'bounce_email' };
    }

    if (!content) {
      console.log(`[Webhook ${correlationId}] Ignored empty message content`);
      return { status: 'ignored', reason: 'empty_content' };
    }

    console.log(`[Webhook ${correlationId}] Incoming user content: "${content}"`);

    // Log message to DB
    await conversacionesRepo.logMessage(conversationId, content, 'user');

    // 5. Check Customer Order Cancellation Request
    const lowerContent = content.toLowerCase();
    if (
      lowerContent.includes('ya no lo quiero') ||
      lowerContent.includes('cancelar mi pedido') ||
      lowerContent.includes('cancela el pedido')
    ) {
      const cancelled = await pedidosService.handleCustomerCancellation(conversationId, accountId);
      if (cancelled) {
        return { status: 'processed', action: 'order_cancelled' };
      }
    }

    // 6. Redis Session Memory (History)
    const sessionKey = `conv_memory:${conversationId}`;
    const rawHistory = (await redis.get(sessionKey)) || '[]';
    let history = JSON.parse(rawHistory);
    history.push({ role: 'user', content });

    // Limit context window to last 10 messages
    if (history.length > 10) history = history.slice(-10);

    // 7. RAG Search Context
    const { contextStr } = await ragService.getRelevantContext(content);

    // 8. Assemble System Prompt
    const baseSystemPrompt =
      (await configuracionRepo.get('system_prompt')) ||
      'Sos el asistente virtual de Kroser Uruguay. Responde de forma amable, clara y concisa.';

    const fullSystemPrompt = `${baseSystemPrompt}\n\n${contextStr}\nREGLAS IMPORTANTES:
- Si el cliente necesita atención humana específica o si no puedes resolver su duda, responde exactamente con: DERIVAR: [AREA] (donde AREA puede ser: ecommerce, rrhh, administracion, franquicias o info).
- Si el cliente desea comprar o hacer un pedido, colecta su Nombre, Teléfono, Dirección de Entrega y los productos deseados.`;

    // 9. Call LLM Service
    const llmReply = await llmService.generateResponse(fullSystemPrompt, history);
    console.log(`[Webhook ${correlationId}] LLM Reply: "${llmReply}"`);

    // 10. Check Human Escalation (DERIVAR... pattern)
    if (llmReply.toUpperCase().startsWith('DERIVAR:')) {
      const match = llmReply.match(/DERIVAR:\s*(\w+)/i);
      const area = match ? match[1].toLowerCase() : 'info';

      const assigneeId = (await configuracionRepo.get(`assignee_id_${area}`)) || 1;
      const msgDerivacion =
        (await configuracionRepo.get('msg_derivacion')) ||
        'Te estoy derivando con un asesor humano que va a poder ayudarte mejor.';

      // Assign in Chatwoot & send fixed message
      await chatwootService.assignAgent(accountId, conversationId, assigneeId);
      await chatwootService.sendMessage(accountId, conversationId, msgDerivacion);

      // Send email alert to internal area
      await emailService.sendDerivationAlert({
        area,
        clienteNombre: sender.name,
        clienteTelefono: sender.phone_number,
        clienteMail: sender.email,
        conversationId,
        motivo: content,
      });

      return { status: 'processed', action: 'human_escalation', area };
    }

    // 11. Send Assistant Response to Chatwoot
    await chatwootService.sendMessage(accountId, conversationId, llmReply);
    await conversacionesRepo.logMessage(conversationId, llmReply, 'assistant');

    // Save updated history in Redis with 24h TTL
    history.push({ role: 'assistant', content: llmReply });
    await redis.set(sessionKey, JSON.stringify(history), 'EX', 86400);

    return { status: 'processed', reply: llmReply };
  },
};

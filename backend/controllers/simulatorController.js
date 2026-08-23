const ragService = require('../services/embeddings/ragService');
const promptBuilder = require('../services/webhook/promptBuilder');
const intentDetector = require('../services/webhook/intentDetector');
const llmService = require('../services/llm/llmService');
const configuracionRepo = require('../repositories/configuracionRepository');
const logger = require('../config/logger');

module.exports = {
  async simulateMessage(req, res, next) {
    const startTime = Date.now();
    try {
      const {
        message = '',
        history = [],
        customerName = 'Cliente de Prueba',
        channel = 'webwidget',
      } = req.body;

      if (!message || typeof message !== 'string' || message.trim() === '') {
        return res.status(400).json({ error: 'El campo message es requerido' });
      }

      const trimmedMessage = message.trim();
      const messageCount = (history.filter((h) => h.role === 'user').length || 0) + 1;

      // 1. Emotion & Intent Detection
      const intentAnalysis = intentDetector.detectIntent(trimmedMessage);
      const detectedEmotion = intentAnalysis.emotion || 'neutral';
      const detectedIntent = intentAnalysis.intent || 'consulta_general';

      // 2. RAG Context Retrieval (Products, Alternatives, Cross-Selling, Stores, Shipping, Payments)
      const ragResult = await ragService.getRelevantContext(trimmedMessage);
      const ragContextStr = ragResult.contextStr || '';

      // 3. Customer Profile Simulation
      const customerProfileStr = `DATOS DEL CLIENTE EN CONTACTO:
- Nombre: ${customerName}
- Canal de origen: ${channel}
- Mensajes previos en esta sesión: ${messageCount - 1}\n\n`;

      // 4. Assemble System Prompt
      const systemPrompt = await promptBuilder.buildSystemPrompt({
        ragContextStr,
        customerProfileStr,
        detectedEmotion,
        messageCount,
        customerName,
      });

      // 5. Query LLM Provider
      const activeProvider = (await configuracionRepo.get('llm_provider')) || process.env.LLM_PROVIDER || 'gemini';
      const activeModel = (await configuracionRepo.get('llm_model')) || process.env.LLM_MODEL || (activeProvider === 'openai' ? 'gpt-4o-mini' : 'gemini-1.5-flash');

      const userMessages = [
        ...history.map((m) => ({ role: m.role || 'user', content: m.content || '' })),
        { role: 'user', content: trimmedMessage },
      ];

      let rawReply = '';
      try {
        rawReply = await llmService.generateResponse(systemPrompt, userMessages, {
          provider: activeProvider,
          model: activeModel,
        });
      } catch (err) {
        logger.warn('Simulator LLM Call Fallback', { error: err.message });
        rawReply = `Estimado cliente, gracias por comunicarse con Kroser. En este momento estamos procesando su consulta sobre "${trimmedMessage}". ${ragResult.productosEncontrados?.length > 0 ? `Disponemos de ${ragResult.productosEncontrados[0].nombre} a U$S ${ragResult.productosEncontrados[0].precio}.` : ''}`;
      }

      const orderExtractor = require('../services/pedidos/orderExtractor');
      const { cleanReply, createdOrder } = await orderExtractor.processOrderFromReply({
        rawReply,
        history: userMessages,
        conversationId: `sim_${Date.now()}`,
        accountId: 1,
        channel,
      });

      const latencyMs = Date.now() - startTime;

      res.json({
        success: true,
        reply: cleanReply,
        pedidoCreated: createdOrder,
        latencyMs,
        provider: activeProvider,
        model: activeModel,
        analysis: {
          emotion: detectedEmotion,
          intent: detectedIntent,
          messageCount,
        },
        rag: {
          contextStr: ragContextStr,
          productos: ragResult.productosEncontrados || [],
          alternativas: ragResult.alternativasEncontradas || [],
          complementarios: ragResult.complementariosEncontrados || [],
          locales: ragResult.localesEncontrados || [],
          zonasEnvio: ragResult.zonasEnvioEncontradas || [],
          formasPago: ragResult.formasPagoEncontradas || [],
        },
        systemPrompt,
      });
    } catch (err) {
      next(err);
    }
  },
};

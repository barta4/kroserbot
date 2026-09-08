const promptBuilder = require('../services/webhook/promptBuilder');
const intentDetector = require('../services/webhook/intentDetector');
const llmService = require('../services/llm/llmService');
const configuracionRepo = require('../repositories/configuracionRepository');
const logger = require('../config/logger');
const orderExtractor = require('../services/pedidos/orderExtractor');

module.exports = {
  async simulateMessage(req, res, next) {
    const startTime = Date.now();
    try {
      const {
        message = '',
        history = [],
        customerName = 'Cliente de Prueba',
        channel = 'webwidget',
        provider: customProvider,
        model: customModel,
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

      // 2. Customer Profile Simulation
      const customerProfileStr = `DATOS DEL CLIENTE EN CONTACTO:
- Nombre: ${customerName}
- Canal de origen: ${channel}
- Mensajes previos en esta sesión: ${messageCount - 1}\n\n`;

      // 3. Assemble Lightweight Agentic System Prompt (No unconditional RAG)
      const systemPrompt = await promptBuilder.buildSystemPrompt({
        customerProfileStr,
        detectedEmotion,
        messageCount,
        customerName,
      });

      // 4. Query LLM Provider with Tools
      const activeProvider = customProvider || (await configuracionRepo.get('llm_provider')) || process.env.LLM_PROVIDER || 'gemini';
      const activeModel = customModel || (await configuracionRepo.get('llm_model')) || process.env.LLM_MODEL || (activeProvider === 'openai' ? 'gpt-4o-mini' : 'gemini-1.5-flash');

      const userMessages = [
        ...history.map((m) => ({ role: m.role || 'user', content: m.content || '' })),
        { role: 'user', content: trimmedMessage },
      ];

      const conversationId = `sim_${Date.now()}`;
      const toolContext = {
        conversationId,
        accountId: 1,
        channel,
        customerName,
      };

      let llmResult = { reply: '', rawReply: '', toolsUsed: [], createdOrder: null };
      try {
        llmResult = await llmService.generateWithTools(systemPrompt, userMessages, {
          provider: activeProvider,
          model: activeModel,
          toolContext,
        });
      } catch (err) {
        logger.warn('Simulator LLM Call Fallback', { error: err.message });
        llmResult.reply = `Estimado cliente, gracias por comunicarse con Kroser. En este momento estamos procesando su consulta sobre "${trimmedMessage}".`;
      }

      // 5. Order Extraction (tool created or heuristic fallback)
      let finalReply = llmResult.reply;
      let finalCreatedOrder = llmResult.createdOrder;

      if (!finalCreatedOrder) {
        const { cleanReply, createdOrder } = await orderExtractor.processOrderFromReply({
          rawReply: finalReply,
          history: userMessages,
          conversationId,
          accountId: 1,
          channel,
        });
        finalReply = cleanReply;
        finalCreatedOrder = createdOrder;
      }

      // 6. Map tools executed to the inspector RAG format for admin UI backward-compatibility
      const prodTool = llmResult.toolsUsed.find((t) => t.name === 'buscar_productos')?.result || {};
      const localesTool = llmResult.toolsUsed.find((t) => t.name === 'buscar_sucursales')?.result || {};
      const envioTool = llmResult.toolsUsed.find((t) => t.name === 'buscar_envio')?.result || {};
      const pagoTool = llmResult.toolsUsed.find((t) => t.name === 'formas_pago')?.result || {};
      const guiasTool = llmResult.toolsUsed.find((t) => t.name === 'consultar_guia_tecnica')?.result || {};

      const latencyMs = Date.now() - startTime;

      const responsePayload = {
        success: true,
        reply: finalReply,
        pedidoCreated: finalCreatedOrder,
        latencyMs,
        provider: activeProvider,
        model: activeModel,
        analysis: {
          emotion: detectedEmotion,
          intent: detectedIntent,
          messageCount,
        },
        toolsUsed: llmResult.toolsUsed.map((t) => ({ name: t.name, args: t.args })),
        rag: {
          contextStr: llmResult.toolsUsed.length > 0 ? `Herramientas ejecutadas: ${llmResult.toolsUsed.map((t) => t.name).join(', ')}` : '',
          productos: prodTool.productos || [],
          alternativas: prodTool.alternativas || [],
          complementarios: prodTool.complementarios_sugeridos || [],
          locales: localesTool.sucursales || [],
          zonasEnvio: envioTool.zonas_envio || [],
          formasPago: pagoTool.formas_pago || [],
          guiasTecnicas: guiasTool.guias_tecnicas || [],
        },
      };

      if (req.query.debug === 'true') {
        responsePayload.systemPrompt = systemPrompt;
        responsePayload.rawReply = llmResult.rawReply;
      }

      res.json(responsePayload);
    } catch (err) {
      next(err);
    }
  },
};

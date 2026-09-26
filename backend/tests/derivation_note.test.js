const chatwootService = require('../services/chatwoot/chatwootService');
const derivationNoteService = require('../services/chatwoot/derivationNoteService');
const llmService = require('../services/llm/llmService');
const configuracionRepo = require('../repositories/configuracionRepository');

describe('Derivation Private Note System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('chatwootService.sendMessage & addPrivateNote', () => {
    test('sendMessage uses mock when no Chatwoot client configured and preserves isPrivate flag', async () => {
      // With default test env, getChatwootClient returns null (mock)
      const outgoingRes = await chatwootService.sendMessage(1, 100, 'Hola cliente', false);
      expect(outgoingRes.success).toBe(true);
      expect(outgoingRes.mock).toBe(true);
      expect(outgoingRes.isPrivate).toBe(false);

      const privateRes = await chatwootService.sendMessage(1, 100, 'Nota interna', true);
      expect(privateRes.success).toBe(true);
      expect(privateRes.mock).toBe(true);
      expect(privateRes.isPrivate).toBe(true);
    });

    test('addPrivateNote calls sendMessage with isPrivate = true', async () => {
      const spySendMessage = jest.spyOn(chatwootService, 'sendMessage');
      try {
        await chatwootService.addPrivateNote(2, 202, 'Nota de prueba');
        expect(spySendMessage).toHaveBeenCalledWith(2, 202, 'Nota de prueba', true);
      } finally {
        spySendMessage.mockRestore();
      }
    });
  });

  describe('derivationNoteService.generateAndSendDerivationNote', () => {
    test('retorna null si falta conversationId', async () => {
      const result = await derivationNoteService.generateAndSendDerivationNote({
        accountId: 1,
        conversationId: null,
      });
      expect(result).toBeNull();
    });

    test('Genera resumen y plan de acción con LLM exitoso y publica nota privada', async () => {
      const mockLlmReply = `📋 **RESUMEN DE LA CONVERSACIÓN**:
• Cliente solicita cotización mayorista de 50 latas de pintura sintética y rodillos.
• Se le informó que disponemos de stock central y que ventas comerciales cotiza por volumen.

🚨 **MOTIVO DE DERIVACIÓN**:
• Volumen mayorista y solicitud de descuento corporativo en VENTAS.

💡 **PLAN DE ACCIÓN SUGERIDO PARA EL ASESOR**:
1. Verificar disponibilidad de las 50 latas en depósito central.
2. Aplicar lista de precios mayorista y calcular flete a obra.
3. Contactar a Juan Pérez al 099123456 con presupuesto formal en PDF.`;

      const spyLlm = jest.spyOn(llmService, 'generateResponse').mockResolvedValue(mockLlmReply);
      const spyAddNote = jest.spyOn(chatwootService, 'addPrivateNote').mockResolvedValue({ success: true, id: 999 });

      try {
        const result = await derivationNoteService.generateAndSendDerivationNote({
          accountId: 1,
          conversationId: 555,
          area: 'ventas',
          sender: {
            name: 'Juan Pérez',
            phone_number: '+59899123456',
            email: 'juan@example.com',
          },
          reason: 'Presupuesto por 50 latas de pintura',
          history: [
            { role: 'user', content: 'Hola, preciso cotización por mayor de 50 latas' },
            { role: 'assistant', content: 'Con gusto, te derivo al equipo de ventas' },
          ],
          ragContextStr: 'Pintura Sintética 4L: $1200 en stock',
        });

        expect(result.success).toBe(true);
        expect(spyLlm).toHaveBeenCalledTimes(1);

        // Verify system prompt contents
        const [systemPromptArg, userMessagesArg] = spyLlm.mock.calls[0];
        expect(systemPromptArg).toContain('VENTAS');
        expect(systemPromptArg).toContain('NOTA INTERNA DE DERIVACIÓN');
        expect(systemPromptArg).toContain('Pintura Sintética 4L');
        expect(userMessagesArg).toHaveLength(2);

        // Verify Chatwoot private note payload
        expect(spyAddNote).toHaveBeenCalledTimes(1);
        const [accId, convId, noteContent] = spyAddNote.mock.calls[0];
        expect(accId).toBe(1);
        expect(convId).toBe(555);
        expect(noteContent).toContain('🤖 **RESUMEN DE DERIVACIÓN — KROSERBOT AI**');
        expect(noteContent).toContain('Juan Pérez');
        expect(noteContent).toContain('+59899123456');
        expect(noteContent).toContain('juan@example.com');
        expect(noteContent).toContain('🏢 **Área Asignada**: VENTAS');
        expect(noteContent).toContain('PLAN DE ACCIÓN SUGERIDO PARA EL ASESOR');
      } finally {
        spyLlm.mockRestore();
        spyAddNote.mockRestore();
      }
    });

    test('Activa fallback determinístico si LLM falla por timeout o error', async () => {
      const spyLlm = jest.spyOn(llmService, 'generateResponse').mockRejectedValue(new Error('LLM Gateway Timeout'));
      const spyAddNote = jest.spyOn(chatwootService, 'addPrivateNote').mockResolvedValue({ success: true, id: 1000 });

      try {
        const result = await derivationNoteService.generateAndSendDerivationNote({
          accountId: 1,
          conversationId: 777,
          area: 'taller',
          sender: {
            name: 'Carlos Gómez',
            phone_number: '+59898765432',
          },
          reason: 'Reparación de amoladora en garantía',
          history: [
            { role: 'user', content: 'Tengo rota una amoladora Bosch en garantía' },
          ],
        });

        expect(result.success).toBe(true);
        expect(spyAddNote).toHaveBeenCalledTimes(1);
        const noteContent = spyAddNote.mock.calls[0][2];

        // Should contain client metadata
        expect(noteContent).toContain('Carlos Gómez');
        expect(noteContent).toContain('+59898765432');
        expect(noteContent).toContain('TALLER');

        // Should contain deterministic fallback elements
        expect(noteContent).toContain('📋 **RESUMEN DE LA CONVERSACIÓN**');
        expect(noteContent).toContain('Tengo rota una amoladora Bosch en garantía');
        expect(noteContent).toContain('🚨 **MOTIVO DE DERIVACIÓN**');
        expect(noteContent).toContain('Reparación de amoladora en garantía');
        expect(noteContent).toContain('💡 **PLAN DE ACCIÓN SUGERIDO PARA EL ASESOR**');
        expect(noteContent).toContain('1. Revisar los últimos mensajes del cliente');
        expect(noteContent).toContain('3. Contactar al cliente presentándose como asesor de TALLER');
      } finally {
        spyLlm.mockRestore();
        spyAddNote.mockRestore();
      }
    });

    test('Maneja de forma segura errores de Chatwoot API sin lanzar excepciones no controladas', async () => {
      jest.spyOn(llmService, 'generateResponse').mockResolvedValue('• Resumen\n• Plan');
      jest.spyOn(chatwootService, 'addPrivateNote').mockRejectedValue(new Error('Network unreachable'));

      const result = await derivationNoteService.generateAndSendDerivationNote({
        accountId: 1,
        conversationId: 888,
        area: 'creditos',
        sender: { name: 'Mariana' },
        reason: 'Consulta de cuenta corriente',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network unreachable');
    });
  });

  describe('Webhook Integration with Derivation Notes', () => {
    const webhookService = require('../services/webhook/webhookService');

    test('Envía nota privada con resumen y plan cuando el LLM responde DERIVAR: ventas', async () => {
      const spyGenerateNote = jest.spyOn(derivationNoteService, 'generateAndSendDerivationNote')
        .mockResolvedValue({ success: true });
      const spyLlmTools = jest.spyOn(llmService, 'generateWithTools')
        .mockResolvedValue({
          reply: 'DERIVAR: ventas',
          rawReply: 'DERIVAR: ventas',
          toolsUsed: [],
          createdOrder: null,
        });
      const spyLlm = jest.spyOn(llmService, 'generateResponse')
        .mockResolvedValue('DERIVAR: ventas');

      try {
        const res = await webhookService.processWebhookEvent({
          event: 'message_created',
          message: { id: 99101, content: 'Necesito presupuesto para compra mayorista de pinturas' },
          sender: { type: 'contact', name: 'Constructora del Sur', phone_number: '+59891234567' },
          conversation: { id: 9911, account_id: 1 },
        });

        expect(res.status).toBe('processed');
        expect(res.action).toBe('human_escalation');
        expect(res.area).toBe('ventas');

        expect(spyGenerateNote).toHaveBeenCalledTimes(1);
        const noteCallArgs = spyGenerateNote.mock.calls[0][0];
        expect(noteCallArgs.accountId).toBe(1);
        expect(noteCallArgs.conversationId).toBe(9911);
        expect(noteCallArgs.area).toBe('ventas');
        expect(noteCallArgs.sender.name).toBe('Constructora del Sur');
        expect(noteCallArgs.reason).toContain('presupuesto para compra mayorista');
      } finally {
        spyGenerateNote.mockRestore();
        spyLlm.mockRestore();
        spyLlmTools.mockRestore();
      }
    });
  });
});

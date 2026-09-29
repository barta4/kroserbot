const chatwootService = require('../services/chatwoot/chatwootService');
const webhookService = require('../services/webhook/webhookService');
const configuracionRepo = require('../repositories/configuracionRepository');
const llmService = require('../services/llm/llmService');
const redis = require('../config/redis');

describe('Derivation Agent Assignment & Label Application', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('chatwootService.getAgents', () => {
    test('retorna lista de agentes mock cuando no hay cliente activo', async () => {
      const agents = await chatwootService.getAgents(1);
      expect(Array.isArray(agents)).toBe(true);
      expect(agents.length).toBeGreaterThan(0);
      expect(agents[0]).toHaveProperty('id');
      expect(agents[0]).toHaveProperty('name');
      expect(agents[0]).toHaveProperty('role');
    });
  });

  describe('chatwootService.assignAgent', () => {
    test('convierte assignee_id a número y envía mock', async () => {
      const res = await chatwootService.assignAgent(1, 999, '42');
      expect(res.success).toBe(true);
      expect(res.mock).toBe(true);
      expect(res.assigneeId).toBe(42);
    });

    test('omite asignación si assignee_id es nulo o vacío', async () => {
      const res = await chatwootService.assignAgent(1, 999, null);
      expect(res.success).toBe(false);
      expect(res.skipped).toBe(true);
    });
  });

  describe('Webhook Derivation Escalation with Agent ID & Label', () => {
    test('asigna el agente configurado y aplica etiqueta "derivar" por defecto', async () => {
      const spyAssign = jest.spyOn(chatwootService, 'assignAgent').mockResolvedValue({ success: true });
      const spyLabels = jest.spyOn(chatwootService, 'addLabels').mockResolvedValue({ success: true });
      const spySendMessage = jest.spyOn(chatwootService, 'sendMessage').mockResolvedValue({ success: true });
      const spyLlmTools = jest.spyOn(llmService, 'generateWithTools').mockResolvedValue({
        reply: 'DERIVAR: ecommerce',
        rawReply: 'DERIVAR: ecommerce',
        toolsUsed: [],
        createdOrder: null,
      });

      // Configuración con derivation_agent_id = 7
      jest.spyOn(configuracionRepo, 'getMultiple').mockResolvedValue({
        assignee_id_ecommerce: null,
        derivation_agent_id: '7',
        chatwoot_default_assignee_id: '7',
        derivation_label: 'derivar',
        msg_derivacion: 'Derivando con un asesor de e-commerce.',
        business_hours_weekday_start: '00:00',
        business_hours_weekday_end: '23:59',
        business_hours_saturday_enabled: 'true',
        business_hours_saturday_start: '00:00',
        business_hours_saturday_end: '23:59',
      });

      try {
        const payload = {
          event: 'message_created',
          message_type: 'incoming',
          content: 'Quiero que me atienda un vendedor de ventas online',
          conversation: { id: 7001, account_id: 1, channel: 'whatsapp' },
          sender: { id: 101, name: 'Carlos Test', phone_number: '+59899123456' },
        };

        const res = await webhookService.processWebhookEvent(payload);

        expect(res.status).toBe('processed');
        expect(res.action).toBe('human_escalation');
        expect(res.area).toBe('ecommerce');

        // Verifica que se haya asignado el agente configurado (7)
        expect(spyAssign).toHaveBeenCalledWith(1, 7001, 7);

        // Verifica que se haya aplicado la etiqueta 'derivar'
        expect(spyLabels).toHaveBeenCalledWith(1, 7001, expect.arrayContaining(['derivar']));
      } finally {
        spyAssign.mockRestore();
        spyLabels.mockRestore();
        spySendMessage.mockRestore();
        spyLlmTools.mockRestore();
      }
    });

    test('prioriza el agente específico del área sobre el agente por defecto', async () => {
      const spyAssign = jest.spyOn(chatwootService, 'assignAgent').mockResolvedValue({ success: true });
      const spyLabels = jest.spyOn(chatwootService, 'addLabels').mockResolvedValue({ success: true });
      const spySendMessage = jest.spyOn(chatwootService, 'sendMessage').mockResolvedValue({ success: true });
      const spyLlmTools = jest.spyOn(llmService, 'generateWithTools').mockResolvedValue({
        reply: 'DERIVAR: rrhh',
        rawReply: 'DERIVAR: rrhh',
        toolsUsed: [],
        createdOrder: null,
      });

      // Configuración con agente general = 7 pero rrhh = 15
      jest.spyOn(configuracionRepo, 'getMultiple').mockResolvedValue({
        assignee_id_rrhh: '15',
        derivation_agent_id: '7',
        chatwoot_default_assignee_id: '7',
        derivation_label: 'atencion-humana',
        msg_derivacion: 'Derivando con Recursos Humanos.',
        business_hours_weekday_start: '00:00',
        business_hours_weekday_end: '23:59',
        business_hours_saturday_enabled: 'true',
        business_hours_saturday_start: '00:00',
        business_hours_saturday_end: '23:59',
      });

      try {
        const payload = {
          event: 'message_created',
          message_type: 'incoming',
          content: 'Quiero enviar mi CV para trabajar en Kroser',
          conversation: { id: 7002, account_id: 1, channel: 'whatsapp' },
          sender: { id: 102, name: 'Ana Postulante' },
        };

        const res = await webhookService.processWebhookEvent(payload);

        expect(res.status).toBe('processed');
        expect(res.action).toBe('human_escalation');
        expect(res.area).toBe('rrhh');

        // Prioriza el agente del área (15)
        expect(spyAssign).toHaveBeenCalledWith(1, 7002, 15);

        // Aplica la etiqueta personalizada configurada
        expect(spyLabels).toHaveBeenCalledWith(1, 7002, expect.arrayContaining(['atencion-humana']));
      } finally {
        spyAssign.mockRestore();
        spyLabels.mockRestore();
        spySendMessage.mockRestore();
        spyLlmTools.mockRestore();
      }
    });
  });
});

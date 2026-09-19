const businessHours = require('../utils/businessHours');
const webhookService = require('../services/webhook/webhookService');
const promptBuilder = require('../services/webhook/promptBuilder');
const llmService = require('../services/llm/llmService');
const redis = require('../config/redis');
const configuracionRepo = require('../repositories/configuracionRepository');
const chatwootService = require('../services/chatwoot/chatwootService');
const emailService = require('../services/email/emailService');

describe('Business Hours & Weekend Management (Meta 24h Window)', () => {
  const defaultConfig = {
    business_hours_weekday_start: '09:00',
    business_hours_weekday_end: '18:00',
    business_hours_saturday_enabled: 'true',
    business_hours_saturday_start: '09:00',
    business_hours_saturday_end: '13:00',
    contact_alternative_email: 'atencion@kroser.com.uy',
    msg_fuera_de_horario: '',
  };

  afterAll(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('1. Date & Time Parsing in Uruguay (UTC-3)', () => {
    test('Correctly extracts day of week and hour in America/Montevideo timezone', () => {
      // 2026-09-16 14:30:00 UTC = 11:30:00 Montevideo (Wednesday, day 3)
      const testDate = new Date('2026-09-16T14:30:00Z');
      const uru = businessHours.getUruguayDate(testDate);

      expect(uru.dayOfWeek).toBe(3); // Wednesday
      expect(uru.hour).toBe(11);
      expect(uru.minute).toBe(30);
    });

    test('parseTimeToMinutes handles valid strings and fallbacks', () => {
      expect(businessHours.parseTimeToMinutes('09:00', 0)).toBe(540);
      expect(businessHours.parseTimeToMinutes('18:30', 0)).toBe(1110);
      expect(businessHours.parseTimeToMinutes('invalid', 60)).toBe(60);
      expect(businessHours.parseTimeToMinutes(null, 60)).toBe(60);
    });
  });

  describe('2. isWithinBusinessHours Logic', () => {
    test('Weekday within business hours (Wednesday 11:30) is open', () => {
      const wednesdayMorning = new Date('2026-09-16T14:30:00Z'); // 11:30 Montevideo
      const res = businessHours.isWithinBusinessHours(wednesdayMorning, defaultConfig);
      expect(res.isWithin).toBe(true);
      expect(res.reason).toBe('open');
    });

    test('Weekday after hours (Tuesday 20:15) is closed', () => {
      const tuesdayNight = new Date('2026-09-15T23:15:00Z'); // 20:15 Montevideo
      const res = businessHours.isWithinBusinessHours(tuesdayNight, defaultConfig);
      expect(res.isWithin).toBe(false);
      expect(res.reason).toBe('out_of_hours');
    });

    test('Weekday early morning before opening (Thursday 07:45) is closed', () => {
      const thursdayEarly = new Date('2026-09-17T10:45:00Z'); // 07:45 Montevideo
      const res = businessHours.isWithinBusinessHours(thursdayEarly, defaultConfig);
      expect(res.isWithin).toBe(false);
      expect(res.reason).toBe('out_of_hours');
    });

    test('Friday night after closing (Friday 19:30) is considered weekend transition', () => {
      const fridayNight = new Date('2026-09-18T22:30:00Z'); // 19:30 Montevideo
      const res = businessHours.isWithinBusinessHours(fridayNight, defaultConfig);
      expect(res.isWithin).toBe(false);
      expect(res.reason).toBe('weekend');
    });

    test('Saturday morning within hours (Saturday 10:30) is open if saturday is enabled', () => {
      const saturdayMorning = new Date('2026-09-19T13:30:00Z'); // 10:30 Montevideo
      const res = businessHours.isWithinBusinessHours(saturdayMorning, defaultConfig);
      expect(res.isWithin).toBe(true);
      expect(res.reason).toBe('open');
    });

    test('Saturday morning is closed if saturday_enabled is false', () => {
      const saturdayMorning = new Date('2026-09-19T13:30:00Z'); // 10:30 Montevideo
      const res = businessHours.isWithinBusinessHours(saturdayMorning, {
        ...defaultConfig,
        business_hours_saturday_enabled: 'false',
      });
      expect(res.isWithin).toBe(false);
      expect(res.reason).toBe('weekend');
    });

    test('Saturday afternoon after closing (Saturday 15:00) is weekend', () => {
      const saturdayAfternoon = new Date('2026-09-19T18:00:00Z'); // 15:00 Montevideo
      const res = businessHours.isWithinBusinessHours(saturdayAfternoon, defaultConfig);
      expect(res.isWithin).toBe(false);
      expect(res.reason).toBe('weekend');
    });

    test('Sunday all day is closed as weekend', () => {
      const sundayMidday = new Date('2026-09-20T15:00:00Z'); // 12:00 Montevideo
      const res = businessHours.isWithinBusinessHours(sundayMidday, defaultConfig);
      expect(res.isWithin).toBe(false);
      expect(res.reason).toBe('weekend');
    });
  });

  describe('3. getNextBusinessDayString Calculation', () => {
    test('Sunday returns Monday opening', () => {
      const sunday = new Date('2026-09-20T17:00:00Z');
      const text = businessHours.getNextBusinessDayString(sunday, defaultConfig);
      expect(text).toBe('el lunes a partir de las 09:00 hs');
    });

    test('Saturday afternoon returns Monday opening', () => {
      const saturdayAfternoon = new Date('2026-09-19T18:00:00Z');
      const text = businessHours.getNextBusinessDayString(saturdayAfternoon, defaultConfig);
      expect(text).toBe('el lunes a partir de las 09:00 hs');
    });

    test('Friday night returns Saturday morning when Saturday is enabled', () => {
      const fridayNight = new Date('2026-09-18T23:00:00Z');
      const text = businessHours.getNextBusinessDayString(fridayNight, defaultConfig);
      expect(text).toBe('mañana sábado a partir de las 09:00 hs');
    });

    test('Friday night returns Monday when Saturday is disabled', () => {
      const fridayNight = new Date('2026-09-18T23:00:00Z');
      const text = businessHours.getNextBusinessDayString(fridayNight, {
        ...defaultConfig,
        business_hours_saturday_enabled: 'false',
      });
      expect(text).toBe('el lunes a partir de las 09:00 hs');
    });

    test('Monday night returns tomorrow morning', () => {
      const mondayNight = new Date('2026-09-14T23:30:00Z');
      const text = businessHours.getNextBusinessDayString(mondayNight, defaultConfig);
      expect(text).toBe('mañana a partir de las 09:00 hs');
    });

    test('Early weekday morning before opening returns today opening', () => {
      const tuesdayDawn = new Date('2026-09-15T10:00:00Z'); // 07:00 Montevideo
      const text = businessHours.getNextBusinessDayString(tuesdayDawn, defaultConfig);
      expect(text).toBe('hoy a partir de las 09:00 hs');
    });
  });

  describe('4. getOutHoursMessage & Meta 24-hour Window Protection', () => {
    test('Generates WhatsApp message warning about 24-hour window closure', () => {
      const msg = businessHours.getOutHoursMessage({
        channel: 'whatsapp',
        nextBusinessDay: 'el lunes a partir de las 09:00 hs',
        alternativeEmail: 'atencion@kroser.com.uy',
      });

      expect(msg).toContain('WhatsApp e Instagram');
      expect(msg).toContain('ventana de conversación se cierra si transcurren más de 24 horas');
      expect(msg).toContain('vuelva a escribirnos el lunes a partir de las 09:00 hs');
      expect(msg).toContain('atencion@kroser.com.uy');
      expect(msg).toContain('sigo aquí a su completa disposición para ayudarle a consultar productos');
    });

    test('Generates Instagram message warning about 24-hour window closure', () => {
      const msg = businessHours.getOutHoursMessage({
        channel: 'Channel::Instagram',
        nextBusinessDay: 'el lunes a partir de las 09:00 hs',
        alternativeEmail: 'atencion@kroser.com.uy',
      });

      expect(msg).toContain('WhatsApp e Instagram');
      expect(msg).toContain('ventana de conversación se cierra');
      expect(msg).toContain('el lunes a partir de las 09:00 hs');
    });

    test('Generates standard out-of-hours message for webwidget without Meta warning', () => {
      const msg = businessHours.getOutHoursMessage({
        channel: 'webwidget',
        nextBusinessDay: 'el lunes a partir de las 09:00 hs',
        alternativeEmail: 'atencion@kroser.com.uy',
      });

      expect(msg).not.toContain('ventana de conversación se cierra');
      expect(msg).toContain('Retomaremos la atención humana el lunes a partir de las 09:00 hs');
      expect(msg).toContain('atencion@kroser.com.uy');
      expect(msg).toContain('sigo disponible aquí en el chat');
    });

    test('Supports custom template with placeholders', () => {
      const customTemplate = 'Cerrado. Vuelve {nextBusinessDay} o escribe a {alternativeEmail}.';
      const msg = businessHours.getOutHoursMessage({
        channel: 'whatsapp',
        nextBusinessDay: 'mañana a las 9:00 hs',
        alternativeEmail: 'info@kroser.uy',
        customTemplate,
      });

      expect(msg).toBe('Cerrado. Vuelve mañana a las 9:00 hs o escribe a info@kroser.uy.');
    });
  });

  describe('5. Temporal Context Prompt for LLM', () => {
    test('Produces out-of-hours directive during weekend prohibiting false promises', () => {
      const sunday = new Date('2026-09-20T17:00:00Z');
      const prompt = businessHours.getTemporalContextPrompt(sunday, defaultConfig);

      expect(prompt).toContain('CONTEXTO TEMPORAL Y HORARIOS (URUGUAY UTC-3)');
      expect(prompt).toContain('domingo');
      expect(prompt).toContain('FUERA DE HORARIO COMERCIAL / ATENCIÓN HUMANA NO DISPONIBLE');
      expect(prompt).toContain('NUNCA prometa ni asegure que un asesor humano atenderá de inmediato');
      expect(prompt).toContain('el lunes a partir de las 09:00 hs');
    });

    test('Produces open business hours directive during weekday work hours', () => {
      const wednesday = new Date('2026-09-16T14:30:00Z');
      const prompt = businessHours.getTemporalContextPrompt(wednesday, defaultConfig);

      expect(prompt).toContain('CONTEXTO TEMPORAL Y HORARIOS (URUGUAY UTC-3)');
      expect(prompt).toContain('miércoles');
      expect(prompt).toContain('HORARIO COMERCIAL HÁBIL ABIERTO');
    });
  });

  describe('6. WebhookService Integration: Out-of-Hours Derivation', () => {
    test('Derivation outside business hours sends 24h Meta advisory and keeps bot alive', async () => {
      // Mock business hours check to simulate Sunday
      jest.spyOn(businessHours, 'isWithinBusinessHours').mockReturnValue({
        isWithin: false,
        reason: 'weekend',
        dayOfWeek: 0,
        hour: 15,
        minute: 0,
      });
      jest.spyOn(businessHours, 'getNextBusinessDayString').mockReturnValue('el lunes a partir de las 09:00 hs');

      const sendMsgSpy = jest.spyOn(chatwootService, 'sendMessage').mockResolvedValue({ success: true });
      const addLabelsSpy = jest.spyOn(chatwootService, 'addLabels').mockResolvedValue({ success: true });
      const emailSpy = jest.spyOn(emailService, 'sendDerivationAlert').mockResolvedValue({ success: true });

      // Mock LLM to trigger derivation
      jest.spyOn(llmService, 'generateWithTools').mockResolvedValueOnce({
        reply: 'DERIVAR: administracion',
        toolsUsed: [],
      });

      const convId = 98801;
      const res = await webhookService.processWebhookEvent({
        event: 'message_created',
        message: { id: 988011, content: 'Necesito hablar con un gerente urgente por mi cuenta' },
        sender: { type: 'contact', name: 'Cliente Fin de Semana', phone_number: '+59899111222' },
        conversation: { id: convId, channel: 'whatsapp' },
      });

      expect(res.status).toBe('processed');
      expect(res.action).toBe('human_escalation');
      expect(res.isOutOfHours).toBe(true);
      expect(res.reason).toBe('weekend');

      // Bot should NOT be silenced in Redis (human_active must not be set)
      const isSilenced = await redis.get(`human_active:${convId}`);
      expect(isSilenced).toBeNull();

      // Sent message must contain 24-hour window closure warning
      expect(sendMsgSpy).toHaveBeenCalledWith(
        expect.any(Number),
        convId,
        expect.stringContaining('ventana de conversación se cierra si transcurren más de 24 horas')
      );

      // Labels should be added to Chatwoot
      expect(addLabelsSpy).toHaveBeenCalledWith(
        expect.any(Number),
        convId,
        expect.arrayContaining(['fuera-de-horario', 'fin-de-semana'])
      );

      // Email alert dispatched with out-of-hours tag
      expect(emailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          area: 'administracion',
          motivo: expect.stringContaining('[FUERA DE HORARIO - WEEKEND]'),
        })
      );
    });

    test('Derivation within business hours silences the bot for human takeover', async () => {
      // Mock business hours check to simulate Wednesday at 11:00
      jest.spyOn(businessHours, 'isWithinBusinessHours').mockReturnValue({
        isWithin: true,
        reason: 'open',
        dayOfWeek: 3,
        hour: 11,
        minute: 0,
      });

      const sendMsgSpy = jest.spyOn(chatwootService, 'sendMessage').mockResolvedValue({ success: true });

      // Mock LLM to trigger derivation
      jest.spyOn(llmService, 'generateWithTools').mockResolvedValueOnce({
        reply: 'DERIVAR: ventas',
        toolsUsed: [],
      });

      const convId = 98802;
      const res = await webhookService.processWebhookEvent({
        event: 'message_created',
        message: { id: 988021, content: 'Quiero comprar 50 palas al por mayor' },
        sender: { type: 'contact', name: 'Empresa Constructora' },
        conversation: { id: convId, channel: 'whatsapp' },
      });

      expect(res.status).toBe('processed');
      expect(res.action).toBe('human_escalation');
      expect(res.isOutOfHours).toBe(false);

      // In business hours, bot MUST be silenced for human takeover
      const isSilenced = await redis.get(`human_active:${convId}`);
      expect(isSilenced).toBe('1');

      // Cleanup
      await redis.del(`human_active:${convId}`);
    });
  });

  describe('7. PromptBuilder Temporal Context Integration', () => {
    test('buildSystemPrompt includes business hours temporal directive', async () => {
      jest.spyOn(configuracionRepo, 'get').mockImplementation(async (key) => {
        if (key === 'system_prompt') return 'Prompt base Kroser';
        if (key === 'pedidos_enabled') return 'true';
        return null;
      });

      const prompt = await promptBuilder.buildSystemPrompt();
      expect(prompt).toContain('CONTEXTO TEMPORAL Y HORARIOS (URUGUAY UTC-3)');
    });
  });
});

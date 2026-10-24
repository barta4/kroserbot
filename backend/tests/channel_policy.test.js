const channelPolicy = require('../services/channel/channelPolicy');
const configuracionRepo = require('../repositories/configuracionRepository');

describe('ChannelPolicy: separación WhatsApp vs. resto de canales', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('normaliza los valores de canal de Uruchat/Chatwoot', () => {
    expect(channelPolicy.normalizeChannel('Channel::Whatsapp')).toBe('whatsapp');
    expect(channelPolicy.normalizeChannel('whatsapp')).toBe('whatsapp');
    expect(channelPolicy.normalizeChannel('Channel::WebWidget')).toBe('web');
    expect(channelPolicy.normalizeChannel('landing_cotibot')).toBe('web');
    expect(channelPolicy.normalizeChannel('Channel::Instagram')).toBe('instagram');
    expect(channelPolicy.normalizeChannel(undefined)).toBe('standard');
  });

  test('WhatsApp es estricto: 300 caracteres, un mensaje y sin alternativas', () => {
    const policy = channelPolicy.resolveChannelPolicy('Channel::Whatsapp');
    expect(policy.id).toBe('whatsapp');
    expect(policy.maxChars).toBe(300);
    expect(policy.maxMessages).toBe(1);
    expect(policy.zeroResultStrategy).toBe('contact');
    expect(policy.allowAlternatives).toBe(false);
  });

  test('web/otros canales pueden explayarse y ofrecer alternativas', () => {
    const policy = channelPolicy.resolveChannelPolicy('Channel::WebWidget');
    expect(policy.id).toBe('standard');
    expect(policy.maxChars).toBeGreaterThan(300);
    expect(policy.allowAlternatives).toBe(true);
  });

  test('clampReply no corta teléfonos y respeta el límite de WhatsApp', () => {
    const policy = channelPolicy.resolveChannelPolicy('whatsapp');
    const short = 'Hola, tenemos membrana a $ 3.480. ¿Le sirve?';
    expect(channelPolicy.clampReply(short, policy)).toBe(short);

    const long = 'Hola, tenemos membrana líquida fibrada de 20 litros a $ 3.480 con su descuento. '.repeat(5);
    const clamped = channelPolicy.clampReply(long, policy);
    expect(clamped.length).toBeLessThanOrEqual(301);
    expect(clamped.endsWith('.') || clamped.endsWith('…')).toBe(true);
  });

  test('mensaje de cero resultados por defecto incluye dirección y teléfono fijos', async () => {
    jest.spyOn(configuracionRepo, 'get').mockResolvedValue(null);
    const message = await channelPolicy.getWhatsAppZeroResultMessage();
    expect(message).toContain('Av. 8 de Octubre 3452');
    expect(message).toContain('2508 3100');
    expect(message).toContain('2509 7508');
    expect(message.length).toBeLessThanOrEqual(300);
    expect(message.toLowerCase()).not.toContain('páseme su ubicación');
  });

  test('el mensaje de cero resultados se puede configurar desde el panel', async () => {
    jest.spyOn(configuracionRepo, 'get').mockResolvedValue('No tenemos stock. Llamá al 2508 3100.');
    const message = await channelPolicy.getWhatsAppZeroResultMessage();
    expect(message).toBe('No tenemos stock. Llamá al 2508 3100.');
  });
});

const { executeTool, TOOL_DEFINITIONS, getGeminiTools, getOpenAITools } = require('../services/webhook/toolExecutor');
const db = require('../config/db');
const productosRepo = require('../repositories/productosRepository');
const localesRepo = require('../repositories/localesRepository');
const guiasTecnicasRepo = require('../repositories/guiasTecnicasRepository');
const pedidosRepo = require('../repositories/pedidosRepository');
const configuracionRepo = require('../repositories/configuracionRepository');
const orderTrackingService = require('../services/pedidos/orderTrackingService');
const emailService = require('../services/email/emailService');

describe('ToolExecutor Test Suite (Herramientas de IA y Function Calling)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Esquemas de herramientas', () => {
    test('TOOL_DEFINITIONS contiene las 7 herramientas oficiales', () => {
      const names = TOOL_DEFINITIONS.map((t) => t.name);
      expect(names).toContain('buscar_productos');
      expect(names).toContain('buscar_sucursales');
      expect(names).toContain('buscar_envio');
      expect(names).toContain('formas_pago');
      expect(names).toContain('consultar_guia_tecnica');
      expect(names).toContain('consultar_pedido');
      expect(names).toContain('registrar_pedido');
    });

    test('getGeminiTools retorna formato compatible con Google GenAI', () => {
      const geminiTools = getGeminiTools();
      expect(Array.isArray(geminiTools)).toBe(true);
      expect(geminiTools[0]).toHaveProperty('functionDeclarations');
      expect(geminiTools[0].functionDeclarations.length).toBe(7);
    });

    test('getOpenAITools retorna formato compatible con OpenAI Chat Completions', () => {
      const openAiTools = getOpenAITools();
      expect(Array.isArray(openAiTools)).toBe(true);
      expect(openAiTools.length).toBe(7);
      expect(openAiTools[0]).toHaveProperty('type', 'function');
      expect(openAiTools[0]).toHaveProperty('function');
    });

    test('ejecutar herramienta desconocida retorna error', async () => {
      const res = await executeTool('herramienta_inexistente', {});
      expect(res).toHaveProperty('error');
      expect(res.error).toMatch(/desconocida/i);
    });
  });

  describe('buscar_productos', () => {
    test('búsqueda con resultados disponibles y cross-selling', async () => {
      jest.spyOn(productosRepo, 'searchByKeyword').mockResolvedValue([
        {
          sku: 'PINT-001',
          nombre: 'Pintura Látex Interior 4L',
          precio: '1200',
          moneda: 'UYU',
          stock_status: 'in_stock',
          categoria: 'pintura',
          marca: 'Inca',
          producto_url: 'https://kroser.com.uy/pintura',
          descripcion: 'Látex lavable para interiores blanco mate',
        },
      ]);
      jest.spyOn(productosRepo, 'getComplementaryItems').mockResolvedValue([
        {
          sku: 'PINC-001',
          nombre: 'Pincel 2 pulgadas',
          precio: '150',
          moneda: 'UYU',
          stock_status: 'in_stock',
        },
      ]);

      const res = await executeTool('buscar_productos', { consulta: 'pintura latex interior' });
      expect(res).toHaveProperty('productos');
      expect(res.productos.length).toBe(1);
      expect(res.productos[0].sku).toBe('PINT-001');
      expect(res.productos[0].precio).toContain('$ 1200 UYU');
      expect(res.productos[0].marca).toBe('Inca');
      expect(res).toHaveProperty('complementarios_sugeridos');
      expect(res.complementarios_sugeridos.length).toBe(1);
    });

    test('búsqueda sin stock activa alternativas sugeridas', async () => {
      jest.spyOn(productosRepo, 'searchByKeyword').mockResolvedValue([
        {
          sku: 'TAL-001',
          nombre: 'Taladro Percutor 650W',
          precio: '2800',
          moneda: 'UYU',
          stock_status: 'out_of_stock',
          categoria: 'taladro',
          marca: 'Bosch',
        },
      ]);
      jest.spyOn(productosRepo, 'getAlternatives').mockResolvedValue([
        {
          sku: 'TAL-002',
          nombre: 'Taladro Percutor 700W',
          precio: '3200',
          moneda: 'UYU',
          stock_status: 'in_stock',
          marca: 'Bosch',
        },
      ]);

      const res = await executeTool('buscar_productos', { consulta: 'taladro' });
      expect(res.productos.length).toBe(1);
      expect(res.productos[0].stock_status).toBe('out_of_stock');
      expect(res).toHaveProperty('alternativas');
      expect(res.alternativas.length).toBe(1);
      expect(res.alternativas[0].sku).toBe('TAL-002');
    });

    test('búsqueda vacía retorna lista vacía sin romper', async () => {
      const res = await executeTool('buscar_productos', { consulta: '' });
      expect(res.productos).toEqual([]);
    });
  });

  describe('buscar_sucursales', () => {
    test('búsqueda con zona específica', async () => {
      jest.spyOn(localesRepo, 'search').mockResolvedValue([
        {
          nombre: 'Kroser Pocitos',
          zona: 'Pocitos',
          direccion: 'Av. Brasil 2500',
          telefono: '2708 0000',
          horario: 'Lun a Vie 8:30 a 18:30, Sáb 8:30 a 13:00',
        },
      ]);

      const res = await executeTool('buscar_sucursales', { zona: 'Pocitos' });
      expect(res).toHaveProperty('sucursales');
      expect(res.sucursales.length).toBe(1);
      expect(res.sucursales[0].nombre).toBe('Kroser Pocitos');
    });

    test('búsqueda sin zona retorna todas las sucursales', async () => {
      jest.spyOn(localesRepo, 'getAll').mockResolvedValue([
        {
          nombre: 'Kroser Centro',
          zona: 'Centro',
          direccion: '18 de Julio 1200',
          telefono: '2900 0000',
        },
      ]);

      const res = await executeTool('buscar_sucursales', {});
      expect(res.sucursales.length).toBe(1);
      expect(res.sucursales[0].nombre).toBe('Kroser Centro');
    });
  });

  describe('buscar_envio', () => {
    test('encuentra zonas de envío con tolerancia de acentos', async () => {
      jest.spyOn(db, 'query').mockResolvedValue({
        rows: [
          {
            departamento_ciudad: 'Montevideo',
            barrio_zona: 'Cordón',
            costo_envio: '250',
          },
          {
            departamento_ciudad: 'Canelones',
            barrio_zona: 'Ciudad de la Costa',
            costo_envio: '0',
          },
        ],
      });

      const res = await executeTool('buscar_envio', { zona: 'Cordon' });
      expect(res).toHaveProperty('zonas_envio');
      expect(res.zonas_envio.length).toBe(1);
      expect(res.zonas_envio[0].costo_envio).toBe('$ 250 UYU');

      const resGratis = await executeTool('buscar_envio', { zona: 'Costa' });
      expect(resGratis.zonas_envio[0].costo_envio).toBe('ENVÍO GRATIS');
    });
  });

  describe('formas_pago', () => {
    test('retorna lista activa de formas de pago', async () => {
      jest.spyOn(db, 'query').mockResolvedValue({
        rows: [
          { nombre: 'Efectivo', descripcion: 'En mostrador o contra entrega' },
          { nombre: 'Mercado Pago', descripcion: 'Tarjetas de crédito y débito' },
        ],
      });

      const res = await executeTool('formas_pago', {});
      expect(res).toHaveProperty('formas_pago');
      expect(res.formas_pago.length).toBe(2);
      expect(res.formas_pago[1].nombre).toBe('Mercado Pago');
    });
  });

  describe('consultar_guia_tecnica', () => {
    test('encuentra guías técnicas relevantes', async () => {
      jest.spyOn(guiasTecnicasRepo, 'searchRelevant').mockResolvedValue([
        {
          titulo: 'Pintura de Paredes',
          categoria: 'Pinturas',
          resumen: 'Preparar la superficie con enduido y fijador.',
          contenido: 'Paso 1: Lijar...',
        },
      ]);

      const res = await executeTool('consultar_guia_tecnica', { tema: 'humedad y pintura' });
      expect(res).toHaveProperty('guias_tecnicas');
      expect(res.guias_tecnicas.length).toBe(1);
      expect(res.guias_tecnicas[0].titulo).toBe('Pintura de Paredes');
    });
  });

  describe('consultar_pedido', () => {
    test('retorna datos de pedido existente mediante trackingService', async () => {
      jest.spyOn(orderTrackingService, 'getTrackingInfo').mockResolvedValue({
        hasOrder: true,
        orderRef: 'ORD-1001',
        status: 'confirmado',
        contextStr: 'Pedido ORD-1001 confirmado',
      });

      const res = await executeTool('consultar_pedido', { referencia: '1001' });
      expect(res.encontrado).toBe(true);
      expect(res.pedido_ref).toBe('ORD-1001');
      expect(res.estado).toBe('confirmado');
    });

    test('retorna mensaje si pedido no existe', async () => {
      jest.spyOn(orderTrackingService, 'getTrackingInfo').mockResolvedValue({
        hasOrder: false,
      });

      const res = await executeTool('consultar_pedido', { referencia: '9999' });
      expect(res.encontrado).toBe(false);
      expect(res.mensaje).toMatch(/no se encontró/i);
    });
  });

  describe('registrar_pedido', () => {
    test('informa si los pedidos están temporalmente deshabilitados en configuración', async () => {
      jest.spyOn(configuracionRepo, 'get').mockResolvedValue('false');

      const res = await executeTool('registrar_pedido', {
        cliente: { nombre: 'Juan Pérez', telefono: '099123456', direccion: 'Pocitos' },
        items: [{ sku: 'ART-1', nombre: 'Pala', cantidad: 1 }],
      });
      expect(res.status).toBe('disabled');
      expect(res.mensaje).toMatch(/deshabilitada/i);
    });

    test('falla si faltan campos obligatorios (nombre, teléfono o dirección/sucursal)', async () => {
      jest.spyOn(configuracionRepo, 'get').mockResolvedValue('true');

      const resSinNombre = await executeTool('registrar_pedido', {
        cliente: { telefono: '099123456', direccion: 'Av Brasil 1234' },
        items: [{ nombre: 'Pala', cantidad: 1 }],
      });
      expect(resSinNombre.status).toBe('error');
      expect(resSinNombre.mensaje).toMatch(/nombre completo/i);

      const resSinTel = await executeTool('registrar_pedido', {
        cliente: { nombre: 'Juan Pérez', direccion: 'Av Brasil 1234' },
        items: [{ nombre: 'Pala', cantidad: 1 }],
      });
      expect(resSinTel.status).toBe('error');
      expect(resSinTel.mensaje).toMatch(/teléfono de contacto/i);

      const resSinDir = await executeTool('registrar_pedido', {
        cliente: { nombre: 'Juan Pérez', telefono: '099123456' },
        items: [{ nombre: 'Pala', cantidad: 1 }],
      });
      expect(resSinDir.status).toBe('error');
      expect(resSinDir.mensaje).toMatch(/dirección de entrega o sucursal de retiro/i);
    });

    test('falla si no hay ítems especificados', async () => {
      jest.spyOn(configuracionRepo, 'get').mockResolvedValue('true');

      const res = await executeTool('registrar_pedido', {
        cliente: { nombre: 'Juan Pérez', telefono: '099123456', direccion: '18 de Julio 1234' },
        items: [],
      });
      expect(res.status).toBe('error');
      expect(res.mensaje).toMatch(/no se especificaron artículos/i);
    });

    test('registra pedido correctamente y dispara alerta de email', async () => {
      jest.spyOn(configuracionRepo, 'get').mockResolvedValue('true');
      jest.spyOn(pedidosRepo, 'create').mockResolvedValue({
        id: 101,
        conversation_id: 'conv_123',
        estado: 'pendiente',
      });
      const spyEmail = jest.spyOn(emailService, 'sendNewOrderAlert').mockResolvedValue(true);

      const res = await executeTool(
        'registrar_pedido',
        {
          cliente: {
            nombre: 'Carlos Gardel',
            telefono: '099887766',
            direccion: '18 de Julio 1000',
          },
          items: [
            { sku: 'PIN-1', nombre: 'Pintura', cantidad: 2, precio: 500 },
          ],
        },
        { conversationId: 'conv_123', accountId: 1 }
      );

      expect(res).toHaveProperty('status', 'ok');
      expect(res.pedido_id).toBe(101);
      expect(res.referencia).toBe('#101');
      expect(spyEmail).toHaveBeenCalled();
    });
  });
});

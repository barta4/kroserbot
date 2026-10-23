const traductorTecnico = require('../utils/traductorTecnico');
const { executeTool } = require('../services/webhook/toolExecutor');
const promptBuilder = require('../services/webhook/promptBuilder');
const searchService = require('../services/search/searchService');

describe('Arquitectura de 3 Roles: Traductor Técnico, Encargado del Depósito y Vendedor del Mostrador', () => {

  describe('1. Rol: El Traductor Técnico (traductorTecnico)', () => {
    test('limpia modismos, saludos, verbos de compra y síntomas', () => {
      const limpio = traductorTecnico.limpiarMensajeColoquial('Hola che vendeme un cortador de caño pvc para una gotera');
      expect(limpio).not.toContain('hola');
      expect(limpio).not.toContain('che');
      expect(limpio).not.toContain('vendeme');
      expect(limpio).not.toContain('gotera');
      expect(limpio).toContain('cortador de caño pvc');
    });

    test('traduce modismo vulgar a término técnico de catálogo', () => {
      const traduccion = traductorTecnico.traducirTermino('cortador de caño pvc');
      expect(traduccion.fueTraducido).toBe(true);
      expect(traduccion.terminoTecnico).toBe('tijera corta tubo pvc');
      expect(traduccion.faltante).toContain('milímetros');
    });

    test('genera ficha técnica completa con dato pendiente si no se especificó medida', () => {
      const ficha = traductorTecnico.generarFichaTecnica('Hola che vendeme un cortador de caño pvc para una gotera');
      expect(ficha.fue_traducido).toBe(true);
      expect(ficha.consulta_tecnica).toBe('tijera corta tubo pvc');
      expect(ficha.faltante).toContain('milímetros');
      expect(ficha.especificaciones.milimetros).toBeUndefined();
    });

    test('resuelve dato faltante si el cliente ya especificó la medida en milímetros', () => {
      const ficha = traductorTecnico.generarFichaTecnica('Preciso una tijera corta tubo pvc de 42 mm');
      expect(ficha.especificaciones.milimetros).toBe('42');
      expect(ficha.faltante).toBeNull();
    });

    test('soporta términos uruguayos tradicionales: trincheta, alargue, colilla', () => {
      const f1 = traductorTecnico.generarFichaTecnica('preciso una trincheta');
      expect(f1.consulta_tecnica).toContain('cutter');

      const f2 = traductorTecnico.generarFichaTecnica('tenes alargue de 10 metros?');
      expect(f2.consulta_tecnica).toContain('cable prolongador');

      const f3 = traductorTecnico.generarFichaTecnica('se me rompio la colilla del baño');
      expect(f3.consulta_tecnica).toContain('flexible mallado colilla');
    });
  });

  describe('2. Rol: El Encargado del Depósito y El Vendedor del Mostrador (executeBuscarProductos)', () => {
    test('el traductor limpia la consulta y el depósito encuentra variantes guiando al vendedor', async () => {
      const spySearch = jest.spyOn(searchService, 'hybridSearch').mockResolvedValue([
        {
          sku: 'KROS-SAN-42',
          nombre: 'Tijera Corta Tubo PVC Truper hasta 42 mm',
          precio: '590',
          moneda: 'UYU',
          stock_status: 'in_stock',
          marca: 'Truper',
        },
        {
          sku: 'KROS-SAN-63',
          nombre: 'Tijera Corta Tubo PVC Truper hasta 63 mm',
          precio: '990',
          moneda: 'UYU',
          stock_status: 'in_stock',
          marca: 'Truper',
        },
      ]);

      const res = await executeTool(
        'buscar_productos',
        { consulta: 'cortador de caño pvc' },
        { lastUserMessage: 'Hola che vendeme un cortador de caño pvc para una gotera' }
      );

      // El depósito buscó con el término técnico oficial
      expect(spySearch).toHaveBeenCalledWith('tijera corta tubo pvc', expect.any(Object));

      // Se encontraron 2 variantes en stock
      expect(res.productos.length).toBe(2);
      expect(res.reporte_deposito).toBeDefined();
      expect(res.reporte_deposito.stock_confirmado).toBe(true);

      // El traductor anotó el dato pendiente (medida en mm)
      expect(res.nota_traductor).toBeDefined();
      expect(res.nota_traductor.dato_pendiente).toContain('milímetros');

      // La directiva guía al vendedor del mostrador a consultar la medida de forma cálida
      expect(res.directiva_vendedor).toContain('Encargado del Depósito');
      expect(res.directiva_vendedor).toContain('Traductor Técnico');
      expect(res.directiva_vendedor).toContain('Vendedor del Mostrador');
      expect(res.directiva_vendedor).toContain('hasta 42 mm');
      expect(res.directiva_vendedor).toContain('hasta 63 mm');

      spySearch.mockRestore();
    });

    test('si el cliente especificó la medida (ej: 42 mm), prioriza esa variante en el depósito', async () => {
      const spySearch = jest.spyOn(searchService, 'hybridSearch').mockResolvedValue([
        {
          sku: 'KROS-SAN-63',
          nombre: 'Tijera Corta Tubo PVC Truper hasta 63 mm',
          precio: '990',
          moneda: 'UYU',
          stock_status: 'in_stock',
          marca: 'Truper',
        },
        {
          sku: 'KROS-SAN-42',
          nombre: 'Tijera Corta Tubo PVC Truper hasta 42 mm',
          precio: '590',
          moneda: 'UYU',
          stock_status: 'in_stock',
          marca: 'Truper',
        },
      ]);

      const res = await executeTool(
        'buscar_productos',
        { consulta: 'tijera corta tubo pvc 42 mm' },
        { lastUserMessage: 'preciso tijera corta tubo pvc de 42 mm' }
      );

      // El producto de 42 mm debe quedar primero en la lista
      expect(res.productos[0].sku).toBe('KROS-SAN-42');
      expect(res.productos[0].nombre).toContain('42 mm');

      spySearch.mockRestore();
    });
  });

  describe('3. Rol: El Vendedor del Mostrador en el System Prompt (promptBuilder)', () => {
    test('el system prompt incluye los 3 roles y las directivas de mostrador consultivo', async () => {
      const prompt = await promptBuilder.buildSystemPrompt({
        ragContextStr: '',
        customerProfileStr: '',
        detectedEmotion: 'neutral',
        messageCount: 1,
      });

      expect(prompt).toContain('EQUIPO DE 3 ROLES');
      expect(prompt).toContain('El Traductor Técnico');
      expect(prompt).toContain('El Encargado del Depósito');
      expect(prompt).toContain('El Vendedor del Mostrador');
      expect(prompt).toContain('CONSULTA CON VARIANTES Y DATO PENDIENTE');
    });
  });

});

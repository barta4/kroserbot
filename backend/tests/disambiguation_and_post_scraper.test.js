const orderTrackingService = require('../services/pedidos/orderTrackingService');
const intentDetector = require('../services/webhook/intentDetector');

describe('H6 & H8 Disambiguation Tests', () => {
  describe('H6: Order Tracking Disambiguation vs Hardware Specifications', () => {
    test('Descarta números de tornillos, mechas y lijas como IDs de pedido', () => {
      expect(orderTrackingService.extractOrderIdentifier('necesito tornillo #8 para madera')).toBeNull();
      expect(orderTrackingService.extractOrderIdentifier('busco mecha #6 para hormigón')).toBeNull();
      expect(orderTrackingService.extractOrderIdentifier('pliego de lija #120 al agua')).toBeNull();
      expect(orderTrackingService.extractOrderIdentifier('arandela #4 y tuerca #4')).toBeNull();
      expect(orderTrackingService.extractOrderIdentifier('broca #10 para taladro')).toBeNull();
    });

    test('Extrae número de pedido cuando está acompañado de palabras clave semánticas', () => {
      expect(orderTrackingService.extractOrderIdentifier('¿Cómo viene mi pedido #1042?')).toBe('1042');
      expect(orderTrackingService.extractOrderIdentifier('estado de la orden #45')).toBe('45');
      expect(orderTrackingService.extractOrderIdentifier('seguimiento de compra 8821')).toBe('8821');
      expect(orderTrackingService.extractOrderIdentifier('nro de pedido 99')).toBe('99');
      expect(orderTrackingService.extractOrderIdentifier('ref 7731')).toBe('7731');
    });

    test('Extrae número standalone con numeral si tiene al menos 4 dígitos', () => {
      expect(orderTrackingService.extractOrderIdentifier('hola quiero saber de #5542')).toBe('5542');
      expect(orderTrackingService.extractOrderIdentifier('consulta por #9102')).toBe('9102');
      // Números cortos aislados no se asumen como pedido
      expect(orderTrackingService.extractOrderIdentifier('consulta por #8')).toBeNull();
    });

    test('intentDetector descarta tracking ante especificaciones técnicas de ferretería', () => {
      const intentTornillo = intentDetector.detectIntent('busco tornillos #8 autoperforantes');
      expect(intentTornillo.isTracking).toBe(false);
      expect(intentTornillo.intent).not.toBe('tracking_pedido');

      const intentMecha = intentDetector.detectIntent('necesito mecha #6 para pared');
      expect(intentMecha.isTracking).toBe(false);
      expect(intentMecha.intent).not.toBe('tracking_pedido');
    });
  });

  describe('H8: Technical Repair & Spare Parts Inquiry vs Commercial Complaint', () => {
    test('Diferencia consultas de reparación y repuestos de reclamos bloqueantes', () => {
      const reparacion1 = intentDetector.detectIntent('tengo un taladro que no arranca, ¿cómo lo arreglo o qué repuesto lleva?');
      expect(reparacion1.isComplaint).toBe(false);
      expect(reparacion1.intent).not.toBe('reclamo');

      const reparacion2 = intentDetector.detectIntent('no me anda la bomba de agua, ¿tienen repuesto o pieza para cambiar?');
      expect(reparacion2.isComplaint).toBe(false);
      expect(reparacion2.intent).not.toBe('reclamo');

      const consultaRotura = intentDetector.detectIntent('se me rompió la correa de la máquina, ¿cuánto sale el repuesto?');
      expect(consultaRotura.isComplaint).toBe(false);
      expect(consultaRotura.intent).not.toBe('reclamo');
    });

    test('Preserva detección estricta de reclamos de garantía y disconformidad', () => {
      const reclamoReal = intentDetector.detectIntent('Quiero hacer un reclamo, me vino fallado el producto de la entrega');
      expect(reclamoReal.isComplaint).toBe(true);
      expect(reclamoReal.intent).toBe('reclamo');
      expect(reclamoReal.emotion).toBe('frustrado');

      const quejaGarantia = intentDetector.detectIntent('Es una queja formal, exijo la garantía porque vino roto');
      expect(quejaGarantia.isComplaint).toBe(true);
      expect(quejaGarantia.intent).toBe('reclamo');
    });
  });
});

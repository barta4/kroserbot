/**
 * Tests for queryAnalyzer.js — Query preprocessing for hybrid search
 */

const { normalizeQuery, detectCode, extractAttributes, tokenize, buildTsQuery, stripStopwords, extractEnrichedProductQuery } = require('../utils/queryAnalyzer');

describe('queryAnalyzer', () => {
  // ─────────────────────────────────────── normalizeQuery
  describe('normalizeQuery', () => {
    it('should normalize accents and case', () => {
      expect(normalizeQuery('Pintura Acrílica')).toBe('pintura acrilica');
    });

    it('should collapse whitespace', () => {
      expect(normalizeQuery('  tornillo   8x50  ')).toBe('tornillo 8x50');
    });

    it('should handle null/empty', () => {
      expect(normalizeQuery(null)).toBe('');
      expect(normalizeQuery('')).toBe('');
      expect(normalizeQuery(undefined)).toBe('');
    });

    it('should preserve technical characters like /', () => {
      expect(normalizeQuery('caño PVC 1/2"')).toContain('1/2');
    });
  });

  // ─────────────────────────────────────── detectCode
  describe('detectCode', () => {
    it('should detect pure numeric codes (≥4 digits)', () => {
      const result = detectCode('7303371');
      expect(result.isCode).toBe(true);
      expect(result.code).toBe('7303371');
    });

    it('should detect codes with "codigo" prefix', () => {
      const result = detectCode('codigo 7303371');
      expect(result.isCode).toBe(true);
      expect(result.code).toBe('7303371');
    });

    it('should detect SKU prefix', () => {
      const result = detectCode('sku ABC-1234');
      expect(result.isCode).toBe(true);
      expect(result.code).toBe('ABC-1234');
    });

    it('should detect "producto" prefix', () => {
      const result = detectCode('producto 12345');
      expect(result.isCode).toBe(true);
      expect(result.code).toBe('12345');
    });

    it('should NOT detect regular text as code', () => {
      expect(detectCode('pintura blanca').isCode).toBe(false);
      expect(detectCode('taladro bosch').isCode).toBe(false);
    });

    it('should NOT detect short numbers (< 4 digits) as codes', () => {
      expect(detectCode('123').isCode).toBe(false);
    });
  });

  // ─────────────────────────────────────── extractAttributes
  describe('extractAttributes', () => {
    it('should extract volume in litros', () => {
      const attrs = extractAttributes('pintura blanca 20 litros');
      expect(attrs.volumen).toBe('20');
    });

    it('should extract volume with L suffix', () => {
      const attrs = extractAttributes('latex 4L');
      expect(attrs.volumen).toBe('4');
    });

    it('should extract color', () => {
      const attrs = extractAttributes('pintura blanca exterior');
      expect(attrs.color).toBe('blanco');
    });

    it('should extract uso interior/exterior', () => {
      expect(extractAttributes('pintura exterior').uso).toBe('exterior');
      expect(extractAttributes('latex interior').uso).toBe('interior');
    });

    it('should extract fractional measurements', () => {
      const attrs = extractAttributes('caño pvc 1/2');
      expect(attrs.medida).toBe('1/2');
    });

    it('should extract dimensions (e.g., 8x50)', () => {
      const attrs = extractAttributes('tornillo 8x50 zincado');
      expect(attrs.dimension).toBe('8x50');
    });

    it('should extract potencia', () => {
      const attrs = extractAttributes('taladro 750w');
      expect(attrs.potencia).toBe('750w');
    });

    it('should extract known brands', () => {
      const attrs = extractAttributes('taladro bosch 13mm');
      expect(attrs.marca).toBe('bosch');
    });

    it('should detect category hint', () => {
      const attrs = extractAttributes('pintura latex interior');
      expect(attrs.categoriaHint).toBe('pintura');
    });

    it('should extract weight in kilos', () => {
      const attrs = extractAttributes('membrana 20 kilos');
      expect(attrs.peso).toBe('20');
    });

    it('should extract size in mm', () => {
      const attrs = extractAttributes('amoladora 115mm');
      expect(attrs.tamano).toBe('115mm');
    });

    it('should detect local Uruguayan synonyms (medio tanque -> parrilla)', () => {
      const attrs = extractAttributes('medio tanque');
      expect(attrs.categoriaHint).toBe('parrillas');
      expect(attrs.synonyms).toContain('parrilla');
      expect(attrs.synonyms).toContain('chulengo');
    });

    it('should detect local synonyms for trincheta', () => {
      const attrs = extractAttributes('trincheta para durlock');
      expect(attrs.synonyms).toContain('cutter');
    });

    it('should handle query with no attributes', () => {
      const attrs = extractAttributes('hola buenos dias');
      expect(Object.keys(attrs).length).toBe(0);
    });
  });

  // ─────────────────────────────────────── tokenize
  describe('tokenize', () => {
    it('should remove stopwords', () => {
      const tokens = tokenize('pintura para el hogar');
      expect(tokens).not.toContain('para');
      expect(tokens).not.toContain('el');
      expect(tokens).toContain('pintura');
      expect(tokens).toContain('hogar');
    });

    it('should preserve fractional measurements', () => {
      const tokens = tokenize('caño pvc 1/2');
      expect(tokens).toContain('1/2');
    });

    it('should preserve dimensions', () => {
      const tokens = tokenize('tornillo 8x50');
      expect(tokens).toContain('8x50');
    });

    it('should remove accents from tokens', () => {
      const tokens = tokenize('electrónica básica');
      expect(tokens).toContain('electronica');
      expect(tokens).toContain('basica');
    });

    it('should filter short tokens (< 2 chars)', () => {
      const tokens = tokenize('a y de o taladro');
      expect(tokens).toEqual(['taladro']);
    });
  });

  // ─────────────────────────────────────── buildTsQuery
  describe('buildTsQuery', () => {
    it('should join tokens with & for tsquery', () => {
      const result = buildTsQuery(['pintura', 'blanca']);
      expect(result).toBe('pintura:* & blanca:*');
    });

    it('should filter out tokens with special chars', () => {
      const result = buildTsQuery(['1/2', 'pvc', '8x50']);
      // 1/2 contains non-alphanumeric, should be filtered; 8x50 is alphanumeric, kept
      expect(result).toBe('pvc:* & 8x50:*');
    });

    it('should return empty string for empty tokens', () => {
      expect(buildTsQuery([])).toBe('');
      expect(buildTsQuery(null)).toBe('');
    });
  });

  // ─────────────────────────────────────── Reranker with Uruguayan Synonyms
  describe('reranker with local synonyms', () => {
    const { rerank } = require('../services/search/reranker');

    it('should rank Parrilla higher than Mecha for "medio tanque" query', () => {
      const attrs = extractAttributes('medio tanque');
      const parrilla = {
        id: 1,
        sku: 'PARR-001',
        nombre: 'Parrilla Tambor Carbón Portátil',
        categoria: 'Jardín y Camping',
        stock_status: 'in_stock',
        precio: '2990',
      };
      const mecha = {
        id: 2,
        sku: 'MECH-002',
        nombre: 'Mecha Copa para Tanque de Agua 1/2',
        categoria: 'Herramientas y Accesorios',
        stock_status: 'in_stock',
        precio: '450',
      };

      const ranked = rerank([mecha, parrilla], 'medio tanque', attrs);
      expect(ranked[0].sku).toBe('PARR-001');
      expect(ranked[0]._score).toBeGreaterThan(ranked[1]._score);
      // Mecha gets category incoherence penalty
      expect(ranked[1]._breakdown.penalty).toBeLessThan(0);
    });

    it('should prioritize Membrana over ceiling fixtures and penalize unrelated categories', () => {
      const { extractEnrichedProductQuery } = require('../utils/queryAnalyzer');
      const consulta = 'membrana';
      const userMsg = 'Hola, necesito membrana para el techo que se me llueve';
      const effectiveQuery = extractEnrichedProductQuery(consulta, userMsg);
      expect(effectiveQuery).toBe('membrana');

      const attrs = extractAttributes(effectiveQuery);
      const items = [
        { sku: 'MEM-01', nombre: 'Membrana liquida fibrada 20kg', categoria: 'Pinturas > Impermeabilizantes', stock_status: 'in_stock', precio: '3900' },
        { sku: 'VEN-02', nombre: 'Ventilador de techo 3 palas', categoria: 'Climatizacion', stock_status: 'in_stock', precio: '2500' },
        { sku: 'PLA-03', nombre: 'Plafon LED de techo 20W', categoria: 'Iluminacion', stock_status: 'in_stock', precio: '690' },
      ];

      const ranked = rerank(items, effectiveQuery, attrs);
      expect(ranked[0].sku).toBe('MEM-01');
      expect(ranked[1]._score).toBeLessThan(0);
      expect(ranked[2]._score).toBeLessThan(0);
    });
  });

  // ─────────────────────────────────────── extractEnrichedProductQuery
  describe('extractEnrichedProductQuery', () => {
    const { extractEnrichedProductQuery } = require('../utils/queryAnalyzer');

    it('should ignore symptom words like "llueve" and surface words like "techo"', () => {
      const res = extractEnrichedProductQuery('membrana', 'Hola, necesito membrana para el techo que se me llueve');
      expect(res).toBe('membrana');
    });

    it('should preserve technical qualifiers and weights from user message', () => {
      const res = extractEnrichedProductQuery('membrana', 'buenas tenes membrana liquida 20 kilos?');
      expect(res).toBe('membrana liquida 20 kilos');
    });

    it('should preserve brands and models from user message', () => {
      const res = extractEnrichedProductQuery('hidrolavadora', 'HIDROLAVADORA ALPHA-PRO 1600W');
      expect(res).toBe('hidrolavadora alpha-pro 1600w');
    });

    it('should clean surface words even when present in LLM consulta', () => {
      const res = extractEnrichedProductQuery('membrana para techo', 'Hola, necesito membrana para el techo que se me llueve');
      expect(res).toBe('membrana');
    });

    it('should enrich query when user provides model or volume and consulta has surface word', () => {
      const res = extractEnrichedProductQuery('membrana para techo', 'Hola, busco membrana liquida fibrada 20kg para la azotea');
      expect(res).toBe('membrana liquida fibrada 20kg');
    });

    it('should extract superficie attribute in extractAttributes', () => {
      const attrs = extractAttributes('membrana para techo');
      expect(attrs.superficie).toBe('techo');

      const attrsPiso = extractAttributes('pintura para piso');
      expect(attrsPiso.superficie).toBe('piso');
    });

    it('should strip problem/surface words in stripStopwords when substantive keywords exist', () => {
      expect(stripStopwords('membrana para techo')).toBe('membrana');
      expect(stripStopwords('ventilador de techo')).toBe('ventilador');
      expect(stripStopwords('techo')).toBe('techo');
    });
  });
});



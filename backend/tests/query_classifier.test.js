jest.mock('../config/redis', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
}));
jest.mock('../repositories/configuracionRepository', () => ({
  getMultiple: jest.fn().mockResolvedValue({ classifier_enabled: 'true', classifier_timeout_ms: '500' }),
  get: jest.fn().mockResolvedValue(null),
}));

const {
  classifyQuery,
  parseJsonLoose,
  validateClassification,
  shouldClassify,
} = require('../services/search/queryClassifier');
const queryAnalyzer = require('../utils/queryAnalyzer');
const { findUySynonyms, detectAccessoryOfMachine } = require('../utils/uyVocabulary');

describe('queryClassifier (agente LLM)', () => {
  test('"hola tenes disco amoladora" -> queries de disco, no la máquina', async () => {
    const llmCall = jest.fn().mockResolvedValue(
      '```json\n{"intencion":"buscar_producto","producto":"disco de corte","compatible_con":"amoladora","queries":["disco corte amoladora","disco desbaste","disco abrasivo"],"confianza":0.92}\n```'
    );
    const res = await classifyQuery('hola tenes disco amoladora', { llmCall });
    expect(res).not.toBeNull();
    expect(res.producto).toBe('disco de corte');
    expect(res.compatible_con).toBe('amoladora');
    expect(res.queries).toContain('disco corte amoladora');
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  test('JSON inválido -> null (fallback por reglas)', async () => {
    const llmCall = jest.fn().mockResolvedValue('Lo siento, no entendí');
    expect(await classifyQuery('tenes disco amoladora', { llmCall })).toBeNull();
  });

  test('timeout del LLM -> null', async () => {
    const llmCall = jest.fn().mockImplementation(() => new Promise(() => {}));
    expect(await classifyQuery('tenes disco amoladora', { llmCall })).toBeNull();
  });

  test('error 429 del LLM -> null', async () => {
    const llmCall = jest.fn().mockRejectedValue(new Error('429'));
    expect(await classifyQuery('tenes disco amoladora', { llmCall })).toBeNull();
  });

  test('códigos SKU no invocan al LLM', async () => {
    const llmCall = jest.fn();
    expect(await classifyQuery('7303371', { llmCall })).toBeNull();
    expect(llmCall).not.toHaveBeenCalled();
  });

  test('consulta de un solo término simple no invoca al LLM', () => {
    expect(shouldClassify('martillo')).toBe(false);
    expect(shouldClassify('hola tenes disco amoladora')).toBe(true);
  });

  test('parseJsonLoose y validateClassification', () => {
    expect(parseJsonLoose('texto {"a":1} fin')).toEqual({ a: 1 });
    expect(parseJsonLoose('sin json')).toBeNull();
    expect(validateClassification({ queries: [] })).toBeNull();
    const v = validateClassification({ producto: 'taladro', confianza: 5 });
    expect(v.queries).toEqual(['taladro']);
    expect(v.confianza).toBe(1);
  });
});

describe('modismos uruguayos y clasificador por reglas', () => {
  test('detecta accesorio de máquina', () => {
    expect(detectAccessoryOfMachine('disco amoladora')).toEqual({ accesorio: 'disco', maquina: 'amoladora' });
    expect(detectAccessoryOfMachine('amoladora')).toBeNull();
  });

  test('"disco amoladora" -> categoría abrasivos y no herramientas', () => {
    const attrs = queryAnalyzer.extractAttributes('hola tenes disco amoladora');
    expect(attrs.categoriaHint).toBe('abrasivos');
    expect(attrs.accesorioDe).toBe('amoladora');
    expect(attrs.synonyms).toEqual(expect.arrayContaining(['disco corte', 'disco desbaste']));
  });

  test('modismos: agujereadora, tirafondo, bolsa de portland, llave de luz', () => {
    expect(findUySynonyms('agujereadora bosch')).toContain('taladro');
    expect(findUySynonyms('tirafondo 8x50')).toContain('tornillo madera');
    expect(findUySynonyms('bolsa de portland')).toContain('cemento portland');
    expect(findUySynonyms('llave de luz')).toContain('interruptor');
  });

  test('voseo y muletillas se eliminan como stopwords', () => {
    expect(queryAnalyzer.stripStopwords('che fijate si tenes disco amoladora')).toBe('disco amoladora');
  });
});

/**
 * Expanded Cross-Selling & Hardware Work Bundles Map - Fuente Única de Verdad
 * Mapea categorías de ferretería con sus insumos y consumibles complementarios frecuentes.
 */
const CROSS_SELLING_MAP = Object.freeze({
  // Pintura & Revestimientos
  pintura: ['pincel', 'rodillo', 'cinta', 'lija', 'bandeja', 'aguarras', 'fijador', 'enduido', 'plastico'],
  latex: ['rodillo', 'pincel', 'cinta', 'bandeja', 'fijador', 'enduido', 'lija'],
  esmalte: ['pincel', 'aguarras', 'diluyente', 'lija', 'antioxido', 'cinta'],
  barniz: ['pincel', 'aguarras', 'lija fina', 'cinta'],
  cetol: ['pincel', 'aguarras', 'lija', 'cinta'],
  membrana: ['malla', 'venda', 'rodillo', 'sellador', 'fijador', 'pincel'],
  impermeabilizante: ['malla', 'venda', 'rodillo', 'sellador', 'fijador'],

  // Herramientas Eléctricas & EPP Obligatorio
  amoladora: ['disco corte', 'disco desbaste', 'disco flap', 'gafas', 'guante', 'protector auditivo'],
  taladro: ['mecha widia', 'mecha acero', 'broca', 'tarugo', 'gafas', 'prolongador'],
  atornillador: ['punta atornillar', 'set puntas', 'tornillo', 'tarugo', 'gafas'],
  sierra: ['hoja sierra', 'disco sierra', 'prensa', 'gafas', 'guante'],

  // Construcción en Seco (Yeso / Drywall)
  yeso: ['solera', 'montante', 'tornillo t1', 'tornillo t2', 'masilla', 'cinta junta', 'lija'],
  placa: ['solera', 'montante', 'tornillo t1', 'tornillo t2', 'masilla', 'cinta junta'],
  drywall: ['solera', 'montante', 'tornillo', 'masilla', 'cinta'],

  // Pisos & Revestimientos
  porcelanato: ['adhesivo', 'pegamento', 'pastina', 'cruceta', 'llana', 'nivelador'],
  ceramica: ['adhesivo', 'pastina', 'cruceta', 'llana', 'esponja'],
  adhesivo: ['llana', 'pastina', 'esponja', 'cruceta'],

  // Sanitaria & Plomería
  sanitaria: ['teflon', 'flexible', 'adhesivo pvc', 'llave francesa'],
  canilla: ['teflon', 'flexible', 'llave francesa', 'cartucho ceramico'],
  griferia: ['flexible', 'teflon', 'llave francesa', 'sellador silicona'],
  inodoro: ['flexible', 'fuelle', 'tornillo fijacion', 'sellador silicona'],
  mochila: ['flexible', 'flotante', 'obturador', 'teflon'],

  // Adhesivos & Selladores
  silicona: ['pistola silicona', 'pistola calafateo', 'cinta papel', 'espatula'],
  poliuretano: ['pistola silicona', 'guante', 'espatula'],
  sellador: ['pistola silicona', 'cinta papel', 'espatula'],

  // Metales & Maderas
  oxido: ['desoxidante', 'antioxido', 'convertidor', 'cepillo alambre', 'lija', 'pincel'],
  reja: ['cepillo alambre', 'esmalte 3 en 1', 'antioxido', 'pincel'],

  // Electricidad
  electricidad: ['cinta aisladora', 'buscapolo', 'cable', 'termica', 'disyuntor', 'pinza'],
  termica: ['cinta aisladora', 'buscapolo', 'cable', 'tablero'],

  // Fijaciones
  tarugo: ['tornillo', 'mecha widia', 'taladro', 'nivel'],
  tornillo: ['tarugo', 'punta atornillar', 'destornillador'],
});

module.exports = CROSS_SELLING_MAP;

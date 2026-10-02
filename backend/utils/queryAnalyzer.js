/**
 * Query Analyzer for Kroserbot Hybrid Search
 *
 * Handles:
 * - Normalization (accents, case) while preserving technical measurements
 * - Detection of code/SKU queries vs. natural language
 * - Extraction of structured attributes from free-text queries
 */

const { normalize } = require('./textNormalizer');

// ──────────────────────────────────────────── Stopwords
const STOPWORDS = new Set([
  'de', 'la', 'el', 'en', 'para', 'con', 'un', 'una', 'y', 'o', 'del',
  'los', 'las', 'al', 'por', 'que', 'qué', 'se', 'es', 'son', 'tenes',
  'tienen', 'hola', 'cuanto', 'cuánto', 'cuesta', 'precio', 'venden', 'hay',
  'me', 'le', 'lo', 'su', 'nos', 'les', 'muy', 'mas', 'más', 'como',
  'esto', 'esta', 'ese', 'esa', 'esos', 'esas', 'algo', 'necesito',
  'busco', 'quiero', 'tengo', 'dame', 'preciso', 'buenas', 'buenos',
  'dias', 'días', 'tardes', 'noches', 'saludos', 'gracias', 'favor',
  'porfa', 'consulta', 'consultar', 'averiguar', 'saber', 'queria',
  'quería', 'quisiera', 'tendran', 'tendras', 'tendrias', 'podes',
  'podrian', 'pueden', 'queda', 'quedan', 'disponen', 'disponible',
  'disponibles', 'si'
]);

// ──────────────────────────────────────────── Known brands (lowercase, normalized)
const KNOWN_BRANDS = [
  'bosch', 'dewalt', 'makita', 'truper', 'stanley', 'fischer',
  'tramontina', 'black.?decker', 'black.?\\+.?decker', 'dremel',
  'karcher', 'kärcher', 'stihl', 'husqvarna', 'einhell', 'skil',
  'gamma', 'lusqtoff', 'neo', 'total', 'ingco', 'bremen',
  'sinteplast', 'sherwin', 'alba', 'recuplast', 'ormiflex',
  'tigre', 'acqua', 'ceresita', 'weber', 'klaukol', 'ferrobet',
  'colorin', 'colorín', 'tersuave', 'ombú', 'ombu', 'harden',
  'alpha.?pro', 'alpha', 'lavor',
];

// ──────────────────────────────────────────── Colors (normalized, no accents)
const COLORS = [
  'blanco', 'negro', 'rojo', 'azul', 'verde', 'amarillo', 'gris',
  'marron', 'beige', 'transparente', 'natural', 'cedro', 'roble',
  'caoba', 'nogal', 'chocolate', 'naranja', 'celeste', 'crema',
  'satinado', 'brillante', 'mate',
];

// ──────────────────────────────────────────── Categories (normalized)
const CATEGORY_HINTS = {
  hidrolavadoras: ['hidrolavadora', 'hidrolavadoras', 'lavadora a presion', 'lavadora de alta presion'],
  pintura: ['pintura', 'latex', 'esmalte', 'barniz', 'impermeabilizante', 'membrana', 'enduido', 'fijador', 'cetol', 'lasur'],
  herramientas: ['taladro', 'amoladora', 'atornillador', 'sierra', 'caladora', 'fresadora', 'lijadora', 'soldadora'],
  electricidad: ['cable', 'termica', 'disyuntor', 'enchufe', 'toma', 'llave', 'tablero', 'prolongador'],
  sanitaria: ['canilla', 'griferia', 'inodoro', 'bidet', 'flexible', 'caño', 'valvula', 'flotante'],
  fijaciones: ['tornillo', 'clavo', 'tarugo', 'bulón', 'tuerca', 'arandela', 'remache'],
  iluminacion: ['lampara', 'foco', 'led', 'reflector', 'dicroica', 'tubo', 'plafon'],
  jardin: ['manguera', 'aspersora', 'tijera poda', 'fumigador', 'cortadora', 'bordeadora'],
  parrillas: ['medio tanque', 'parrilla', 'barbacoa', 'chulengo', 'carbon', 'fogonero', 'churrasquera', 'parrillero', 'parrilleros'],
  adhesivos: ['silicona', 'sellador', 'pegamento', 'cola', 'adhesivo', 'epoxi', 'cianoacrilato'],
  abrasivos: ['lija', 'disco corte', 'disco desbaste', 'piedra', 'muela', 'disco flap'],
};

// ──────────────────────────────────────────── Local Uruguayan Hardware Synonyms
// Maps popular local vernacular to formal retail catalog terminology
const LOCAL_SYNONYMS = {
  'medio tanque': ['parrilla', 'chulengo', 'barbacoa', 'parrillero'],
  'parrillero': ['parrilla', 'chulengo', 'barbacoa', 'medio tanque'],
  'parrillera': ['parrilla', 'chulengo', 'barbacoa', 'medio tanque'],
  'trincheta': ['cutter', 'cuchilla'],
  'cuerito': ['valvula', 'arandela canilla'],
  'alargue': ['prolongador', 'cable alargue'],
  'zapatilla': ['base multiple', 'prolongador'],
  'colilla': ['flexible', 'mallado'],
  'fuelle': ['inodoro', 'cisterna'],
  'championes': ['calzado seguridad', 'botas trabajo'],
  'chismosa': ['carro compras', 'bolso compras'],
  'fleje': ['cinta pasacable'],
  'canilla': ['griferia'],
};

/**
 * Strip common stopwords from query to isolate substantive search keywords.
 * @param {string} str - Query string
 * @returns {string} Substantive keywords joined by space
 */
function stripStopwords(str) {
  if (!str || typeof str !== 'string') return '';
  const norm = normalizeQuery(str);
  return norm.split(/\s+/).filter((t) => t.length >= 2 && !STOPWORDS.has(t)).join(' ');
}

/**
 * Normalize query preserving technical measurements and special chars.
 * @param {string} raw - Raw user query
 * @returns {string} Normalized query
 */
function normalizeQuery(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!.,;:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Intelligently enrich or restore the product query using the original user message.
 * LLMs frequently over-generalize to broad categories (e.g. calling buscar_productos with "hidrolavadora"
 * when the user explicitly said "hidrolavadora alpha-pro 1600w").
 *
 * @param {string} consulta - Query passed by LLM function call
 * @param {string} userMessage - Raw message sent by the user in this turn
 * @returns {string} Substantive search query preserving model/brand
 */
function extractEnrichedProductQuery(consulta, userMessage) {
  const baseQuery = (consulta || '').trim();
  if (!userMessage || typeof userMessage !== 'string') return baseQuery;

  const rawUser = userMessage.trim();
  if (!rawUser) return baseQuery;

  // Split into sentences / clauses
  const sentences = rawUser
    .split(/[\n.;?!]|\by\s+ademas\b|\by\s+tambien\b/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const baseTokens = baseQuery.toLowerCase().split(/\s+/).filter(Boolean);
  let targetSentence = '';

  if (baseTokens.length > 0) {
    targetSentence =
      sentences.find((s) => {
        const lower = s.toLowerCase();
        return baseTokens.some((t) => lower.includes(t));
      }) ||
      sentences[0] ||
      rawUser;
  } else {
    targetSentence = sentences[0] || rawUser;
  }

  const cleanUserPart = stripStopwords(targetSentence);
  if (!cleanUserPart) return baseQuery;

  // If the user's sentence contains more detail (brand, model, numbers, power specs)
  if (cleanUserPart.length > baseQuery.length) {
    const cleanTokens = cleanUserPart.toLowerCase().split(/\s+/);
    const matchesAny =
      baseTokens.length === 0 ||
      baseTokens.some((t) => cleanTokens.some((ct) => ct.includes(t) || t.includes(ct)));
    if (matchesAny) {
      return cleanUserPart;
    }
  }

  return baseQuery;
}

/**
 * Detect if the query is a code/SKU lookup.
 * @param {string} query - Normalized query
 * @returns {{ isCode: boolean, code: string|null }}
 */
function detectCode(query) {
  const cleaned = query.replace(/\s+/g, '').trim();

  // Pure numeric code (≥4 digits) — e.g. "7303371"
  if (/^\d{4,}$/.test(cleaned)) {
    return { isCode: true, code: cleaned };
  }

  // "codigo XXXX", "sku XXXX", "producto XXXX", "articulo XXXX", "art XXXX"
  const codePrefix = query.match(/\b(?:codigo|sku|producto|articulo|art|ref|referencia|cod)\s+([a-z0-9][-a-z0-9]{2,})/i);
  if (codePrefix) {
    return { isCode: true, code: codePrefix[1] };
  }

  // Alphanumeric with hyphens (SKU patterns like "ABC-1234" or "12-345-678")
  if (/^[a-z0-9][-a-z0-9]{3,}$/i.test(cleaned) && /\d/.test(cleaned) && /[a-z]/i.test(cleaned) && cleaned.includes('-')) {
    return { isCode: true, code: cleaned };
  }

  return { isCode: false, code: null };
}

/**
 * Extract structured attributes from a free-text query.
 * @param {string} query - Normalized query
 * @returns {Object} Extracted attributes
 */
function extractAttributes(query) {
  const attrs = {};
  const normalized = normalizeQuery(query);

  // ── Volume: "20 litros", "4L", "18l", "1 litro"
  const volMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:litros?|lts?|l)\b/);
  if (volMatch) {
    attrs.volumen = volMatch[1].replace(',', '.');
  }

  // ── Weight: "20 kilos", "5kg", "1 kilo"
  const weightMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:kilos?|kgs?|kg)\b/);
  if (weightMatch) {
    attrs.peso = weightMatch[1].replace(',', '.');
  }

  // ── Fractional measurements: "1/2", "3/4" (inches in plumbing)
  const fracMatch = normalized.match(/(\d+\/\d+)\s*[""]?/);
  if (fracMatch) {
    attrs.medida = fracMatch[1];
  }

  // ── Dimensions: "8x50", "6x40", "4 x 50"
  const dimMatch = normalized.match(/(\d+)\s*[xX×]\s*(\d+)/);
  if (dimMatch) {
    attrs.dimension = `${dimMatch[1]}x${dimMatch[2]}`;
  }

  // ── Size in mm/cm/m: "115mm", "2.5m", "30cm"
  const sizeMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(mm|cm|m|pulgadas?|pulg)\b/);
  if (sizeMatch) {
    attrs.tamano = `${sizeMatch[1].replace(',', '.')}${sizeMatch[2]}`;
  }

  // ── Power: "750w", "21v", "12v", "2hp"
  const potMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(w|watts?|v|volts?|hp|amperes?|amp|a)\b/);
  if (potMatch) {
    attrs.potencia = `${potMatch[1].replace(',', '.')}${potMatch[2].toLowerCase()}`;
  }

  // ── Color (handles Spanish gender: blanca→blanco, negra→negro, etc.)
  const COLOR_VARIANTS = {
    blanca: 'blanco', blancas: 'blanco', blancos: 'blanco',
    negra: 'negro', negras: 'negro', negros: 'negro',
    roja: 'rojo', rojas: 'rojo', rojos: 'rojo',
    azules: 'azul',
    verdes: 'verde',
    amarilla: 'amarillo', amarillas: 'amarillo', amarillos: 'amarillo',
    grises: 'gris',
    marrones: 'marron',
    naranja: 'naranja', naranjas: 'naranja',
    celestes: 'celeste',
  };
  // First check exact color names
  let colorFound = false;
  for (const c of COLORS) {
    const pattern = new RegExp(`\\b${c}\\b`);
    if (pattern.test(normalized)) {
      attrs.color = c;
      colorFound = true;
      break;
    }
  }
  // Then check variants
  if (!colorFound) {
    for (const [variant, canonical] of Object.entries(COLOR_VARIANTS)) {
      const pattern = new RegExp(`\\b${variant}\\b`);
      if (pattern.test(normalized)) {
        attrs.color = canonical;
        break;
      }
    }
  }

  // ── Usage: interior/exterior
  if (/\bexterior\b/.test(normalized)) {
    attrs.uso = 'exterior';
  } else if (/\binterior\b/.test(normalized)) {
    attrs.uso = 'interior';
  }

  // ── Brand
  for (const brand of KNOWN_BRANDS) {
    const pattern = new RegExp(`\\b${brand}\\b`, 'i');
    const match = normalized.match(pattern);
    if (match) {
      attrs.marca = match[0];
      break;
    }
  }

  // ── Category hint (detected, not filtered — used for scoring boost)
  for (const [cat, keywords] of Object.entries(CATEGORY_HINTS)) {
    for (const kw of keywords) {
      if (normalized.includes(kw)) {
        attrs.categoriaHint = cat;
        break;
      }
    }
    if (attrs.categoriaHint) break;
  }

  // ── Local Uruguayan Synonyms
  for (const [idiom, syns] of Object.entries(LOCAL_SYNONYMS)) {
    if (normalized.includes(idiom)) {
      attrs.synonyms = (attrs.synonyms || []).concat(syns);
    }
  }

  return attrs;
}

/**
 * Tokenize query for multi-word ILIKE search, preserving technical measurements.
 * @param {string} query - Normalized query
 * @returns {string[]} Filtered tokens
 */
function tokenize(query) {
  const normalized = normalizeQuery(query);

  // Preserve fractional measurements and dimensions before splitting
  const preserved = normalized
    .replace(/(\d+)\/(\d+)/g, '$1FRAC$2')          // 1/2 → 1FRAC2
    .replace(/(\d+)\s*x\s*(\d+)/g, '$1DIM$2');     // 8x50 → 8DIM50

  const rawTokens = preserved
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9/]/gi, ''))
    .filter(Boolean);

  // Restore preserved patterns and filter
  return rawTokens
    .map((t) => t.replace(/FRAC/g, '/').replace(/DIM/g, 'x'))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Build a tsquery string for PostgreSQL Full Text Search from tokens.
 * Joins tokens with & (AND) operator for precise matching.
 * @param {string[]} tokens - Array of search tokens
 * @returns {string} tsquery string (e.g. "pintura & blanca & 20")
 */
function buildTsQuery(tokens) {
  if (!tokens || tokens.length === 0) return '';
  // Remove tokens with special chars that break tsquery (fractions, dimensions)
  const safe = tokens.filter((t) => /^[a-z0-9]+$/i.test(t));
  if (safe.length === 0) return '';
  return safe.map((t) => `${t}:*`).join(' & ');
}

module.exports = {
  normalizeQuery,
  detectCode,
  extractAttributes,
  tokenize,
  buildTsQuery,
  STOPWORDS,
  KNOWN_BRANDS,
  COLORS,
  CATEGORY_HINTS,
  LOCAL_SYNONYMS,
  stripStopwords,
  extractEnrichedProductQuery,
};

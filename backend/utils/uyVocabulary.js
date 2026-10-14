/**
 * Vocabulario ferretero uruguayo (modismos de mostrador).
 *
 * Fuente única para:
 *  - El clasificador por reglas (queryAnalyzer.js)
 *  - El prompt del agente clasificador (queryClassifier.js)
 *
 * Todas las claves están normalizadas (minúsculas, sin tildes).
 */

// Modismo / término popular → términos del catálogo
const UY_SYNONYMS = {
  // Herramientas
  agujereadora: ['taladro'],
  berbiqui: ['taladro'],
  rotopercutora: ['taladro percutor', 'taladro'],
  esmeril: ['amoladora'],
  pulidora: ['amoladora', 'pulidora'],
  tronzadora: ['sierra de corte', 'sierra'],
  caladora: ['sierra caladora'],

  // Fijaciones
  tirafondo: ['tornillo madera', 'tirafondo'],
  tirafondos: ['tornillo madera', 'tirafondo'],
  clavija: ['tarugo'],
  'tarugo fischer': ['tarugo'],

  // Sanitaria
  bacha: ['pileta', 'bacha'],
  pileton: ['pileta'],
  piletin: ['pileta'],
  sifon: ['sifon', 'desague'],
  flotante: ['valvula carga', 'flotante'],
  'medio tanque': ['parrilla', 'chulengo', 'barbacoa', 'parrillero'],
  fuelle: ['inodoro', 'cisterna'],
  colilla: ['flexible', 'mallado'],
  cuerito: ['canilla', 'grifo', 'griferia'],
  cueritos: ['canilla', 'grifo', 'griferia'],
  canilla: ['griferia'],

  // Electricidad
  'llave de luz': ['interruptor'],
  tomacorriente: ['toma', 'enchufe'],
  alargue: ['prolongador', 'cable alargue'],
  zapatilla: ['base multiple', 'prolongador'],
  'cinta aisladora': ['cinta aisladora'],
  termica: ['disyuntor', 'termica'],

  // Pintura y acabados
  sintetico: ['esmalte sintetico'],
  felpa: ['rodillo'],
  pincelessa: ['pincel', 'brocha'],

  // Construcción
  portland: ['cemento portland', 'cemento'],
  'bolsa de portland': ['cemento portland'],
  pastina: ['pastina', 'fragua'],

  // Abrasivos / accesorios de amoladora
  'disco amoladora': ['disco corte', 'disco desbaste', 'disco flap'],
  'disco de amoladora': ['disco corte', 'disco desbaste', 'disco flap'],
  'disco para amoladora': ['disco corte', 'disco desbaste', 'disco flap'],
  'disco esmeril': ['disco corte', 'disco desbaste'],

  // Otros
  trincheta: ['cutter', 'cuchilla'],
  parrillero: ['parrilla', 'chulengo', 'barbacoa', 'medio tanque'],
  parrillera: ['parrilla', 'chulengo', 'barbacoa', 'medio tanque'],
  championes: ['calzado seguridad', 'botas trabajo'],
  chismosa: ['carro compras', 'bolso compras'],
  fleje: ['cinta pasacable'],
};

// Muletillas, voseo y expresiones rioplatenses que no describen un producto
const UY_STOPWORDS = [
  'tenes', 'tenian', 'tenias', 'tendran', 'fijate', 'fijese', 'che', 'bo',
  'capaz', 'ta', 'dale', 'andan', 'mandame', 'pasame',
  'dame', 'damelo', 'decime', 'avisame', 'consulto', 'consultarte',
  'alguno', 'alguna', 'algun', 'unos', 'unas', 'unito', 'unita', 'poquito',
  'bastante', 'mira', 'estimado', 'amigo',
  'andaba', 'buscando', 'vendes', 'manejan', 'trabajan',
];

// Palabras que indican accesorio / consumible / repuesto de una máquina
const ACCESSORY_WORDS = [
  'disco', 'discos', 'mecha', 'mechas', 'broca', 'brocas', 'hoja', 'hojas',
  'repuesto', 'repuestos', 'filtro', 'filtros', 'bolsa', 'bolsas', 'cadena',
  'carbones', 'carbon', 'bateria', 'baterias', 'cargador', 'punta', 'puntas',
  'lija', 'lijas', 'cuchilla', 'cuchillas', 'boquilla', 'boquillas',
];

// Máquinas / herramientas a las que se les compran accesorios
const MACHINE_WORDS = [
  'amoladora', 'taladro', 'sierra', 'caladora', 'lijadora', 'fresadora',
  'hidrolavadora', 'motosierra', 'bordeadora', 'esmeril', 'agujereadora',
  'rotopercutora', 'atornillador', 'soldadora', 'cortadora', 'pulidora',
];

/**
 * Devuelve los sinónimos uruguayos que aplican a un texto ya normalizado.
 * @param {string} normalized
 * @returns {string[]}
 */
function findUySynonyms(normalized) {
  if (!normalized) return [];
  const out = [];
  // Primero claves más largas (frases) para priorizarlas
  const keys = Object.keys(UY_SYNONYMS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const pattern = new RegExp(`(?:^|\\s)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`);
    if (pattern.test(normalized)) {
      for (const syn of UY_SYNONYMS[key]) {
        if (!out.includes(syn)) out.push(syn);
      }
    }
  }
  return out;
}

/**
 * Detecta patrón "accesorio + máquina" (ej. "disco amoladora").
 * @param {string} normalized
 * @returns {{ accesorio: string, maquina: string } | null}
 */
function detectAccessoryOfMachine(normalized) {
  if (!normalized) return null;
  const tokens = normalized.split(/\s+/);
  const accesorio = tokens.find((t) => ACCESSORY_WORDS.includes(t));
  const maquina = tokens.find((t) => MACHINE_WORDS.includes(t));
  if (accesorio && maquina) return { accesorio, maquina };
  return null;
}

module.exports = {
  UY_SYNONYMS,
  UY_STOPWORDS,
  ACCESSORY_WORDS,
  MACHINE_WORDS,
  findUySynonyms,
  detectAccessoryOfMachine,
};

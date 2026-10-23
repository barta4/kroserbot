/**
 * ==============================================================================
 * EL TRADUCTOR TÉCNICO — Parser, Normalizador & Traductor de Modismos Ferreteros
 * ==============================================================================
 * 
 * Rol en el equipo de 3 empleados:
 * 1. Escucha lo que dice el cliente por WhatsApp (con modismos, apuro o preguntas compuestas).
 * 2. Le "limpia" el mensaje al Encargado del Depósito: saca palabras que estorban
 *    ("vendeme", "preciso", "tenés", "buenas che") y traduce términos vulgares/locales
 *    a nombres técnicos de catálogo ("cortador de caño pvc" ➔ "tijera corta tubo pvc").
 * 3. Prepara notas técnicas con los datos clave que falten definir (ej: medida en mm).
 */

const { normalize } = require('./textNormalizer');

// Palabras y frases que estorban (ruido conversacional, verbos de compra, saludos)
const PALABRAS_ESTORBO = [
  'vendeme', 'venderias', 'me podes vender', 'me podrias vender', 'venden', 'vende',
  'preciso', 'precisaba', 'precisaria', 'necesito', 'necesitaria',
  'tenes', 'tenés', 'tienen', 'tendran', 'tendrás', 'tendras', 'tendrian', 'tendrían',
  'dame', 'pasame', 'pasame precio', 'conseguime',
  'busco', 'buscaba', 'quiero', 'queria', 'quería', 'quisiera',
  'cuanto sale', 'cuánto sale', 'cuanto cuesta', 'cuánto cuesta', 'cuanto me sale',
  'cuanto vale', 'cuánto vale', 'que precio tiene', 'precio de', 'valor de',
  'me das', 'me pasas', 'me pasás', 'cotizame', 'me podes cotizar',
  'buenas', 'buenas tardes', 'buenos dias', 'buenas noches', 'hola', 'che', 'saludos',
  'porfa', 'por favor', 'gracias', 'muchas gracias', 'estimado', 'estimados',
  'hay', 'queda', 'quedan', 'disponible', 'disponibles', 'stock de',
  'para una gotera', 'para arreglar una gotera', 'se me rompio', 'se me rompió',
  'para reparar', 'para arreglar', 'para cambiar', 'para colocar', 'para poner',
  'del bano', 'del baño', 'de la cocina', 'del techo', 'de la pared'
];

// Diccionario de Traducción Técnica de Modismos y Términos Vulgares ➔ Nombre Oficial Catálogo
const DICCIONARIO_TECNICO = [
  // Cortadores y herramientas de corte
  {
    patrones: [
      /cortador(?:a)?\s+(?:de\s+)?ca[ñn]o(?:s)?(?:\s+pvc)?/i,
      /corta(?:r)?\s+ca[ñn]o(?:s)?(?:\s+pvc)?/i,
      /corta(?:r)?\s+tubo(?:s)?(?:\s+pvc)?/i,
      /cortador(?:a)?\s+(?:de\s+)?tubo(?:s)?(?:\s+pvc)?/i,
      /cortaca[ñn]o(?:s)?/i,
      /cortatubo(?:s)?/i,
      /tijera\s+(?:de\s+)?ca[ñn]o(?:s)?/i
    ],
    terminoTecnico: 'tijera corta tubo pvc',
    categoria: 'Sanitaria / Herramientas',
    faltante: 'medida o diámetro del caño en milímetros (ej: hasta 42 mm o hasta 63 mm)',
  },
  {
    patrones: [/cortador(?:a)?\s+(?:de\s+)?ca[ñn]o(?:s)?\s+(?:de\s+)?cobre/i, /corta\s+tubo\s+cobre/i],
    terminoTecnico: 'corta tubo cobre cortador cano',
    categoria: 'Sanitaria / Refrigeración',
    faltante: 'diámetro del tubo de cobre',
  },
  {
    patrones: [/\btrinchetas?\b/i, /\btrinchetes?\b/i],
    terminoTecnico: 'cutter cuchilla trincheta',
    categoria: 'Herramientas',
    faltante: 'ancho de la hoja (ej: 9mm o 18mm)',
  },

  // Electricidad y extensiones
  {
    patrones: [/\balargues?\b/i, /\balargador(?:es)?\b/i],
    terminoTecnico: 'cable prolongador alargue',
    categoria: 'Electricidad',
    faltante: 'longitud en metros (ej: 5m, 10m, 20m) y amperaje',
  },
  {
    patrones: [/\bzapatilla(?:s)?\b/i, /zapatilla(?:s)?\s+electrica(?:s)?/i],
    terminoTecnico: 'base multiple prolongador zapatilla',
    categoria: 'Electricidad',
    faltante: 'cantidad de tomas (ej: 3, 4 o 5 tomas)',
  },
  {
    patrones: [/\bfleje(?:s)?\b/i, /pasa\s*cables?/i],
    terminoTecnico: 'cinta pasacable fleje',
    categoria: 'Electricidad',
    faltante: 'largo en metros (ej: 10m, 15m, 20m)',
  },

  // Sanitaria y grifería
  {
    patrones: [/\bcolillas?\b/i, /colilla(?:s)?\s+(?:de\s+)?(?:agua|bano|bacha|canilla)/i],
    terminoTecnico: 'flexible mallado colilla sanitaria',
    categoria: 'Sanitaria',
    faltante: 'largo (ej: 30cm, 40cm, 50cm) y rosca (1/2")',
  },
  {
    patrones: [/\bfuelles?\b/i, /fuelle(?:s)?\s+(?:de\s+)?inodoro/i],
    terminoTecnico: 'conexion fuelle inodoro',
    categoria: 'Sanitaria',
    faltante: 'si es excéntrico o recto',
  },
  {
    patrones: [/\bcueritos?\b/i],
    terminoTecnico: 'valvula cuerito canilla',
    categoria: 'Sanitaria',
    faltante: 'medida (ej: 1/2" o 3/4")',
  },
  {
    patrones: [/\bsopapas?\b/i],
    terminoTecnico: 'sopapa desague',
    categoria: 'Sanitaria',
    faltante: 'si es para bacha, lavatorio o pileta patio',
  },
  {
    patrones: [/\bcanillas?\b/i, /\bgrifos?\b/i],
    terminoTecnico: 'griferia canilla monocomando',
    categoria: 'Sanitaria',
    faltante: 'si es para cocina, lavatorio o exterior',
  },

  // Selladores e impermeabilizantes
  {
    patrones: [/fastix/i, /sellador\s+(?:para\s+)?ba[ñn]o/i, /silicona\s+(?:para\s+)?ba[ñn]o/i],
    terminoTecnico: 'silicona sellador antihongo banos',
    categoria: 'Pinturas / Adhesivos',
    faltante: 'si prefiere transparente o blanco',
  },
  {
    patrones: [/membrana\s+(?:para\s+)?gotera/i, /pintura\s+(?:para\s+)?gotera/i, /pintura\s+(?:de|para)\s+techo/i],
    terminoTecnico: 'membrana liquida fibrada impermeabilizante',
    categoria: 'Pinturas',
    faltante: 'metros cuadrados a cubrir y color (blanco, rojo, gris)',
  },

  // Herramientas eléctricas y accesorios
  {
    patrones: [/pistola\s+(?:de\s+)?calor/i],
    terminoTecnico: 'pistola calor decapador termico',
    categoria: 'Herramientas',
    faltante: 'potencia requerida (ej: 1800W o 2000W)',
  },
  {
    patrones: [/soldadora\s+(?:electrica|de\s+alambre)/i],
    terminoTecnico: 'soldadora inverter electrodo mig',
    categoria: 'Herramientas',
    faltante: 'amperaje deseado (ej: 140A, 160A, 200A)',
  },
  {
    patrones: [/disco\s+(?:para\s+)?(?:cortar\s+)?hierro/i, /disco\s+(?:para\s+)?(?:cortar\s+)?metal/i],
    terminoTecnico: 'disco corte metal amoladora',
    categoria: 'Herramientas',
    faltante: 'diámetro del disco (ej: 115mm / 4½" o 230mm / 9")',
  },

  // Camping / Asador / Hogar
  {
    patrones: [/medio\s+tanque/i, /\bparrilleros?\b/i, /\bparrilleras?\b/i, /\bchulengo\b/i],
    terminoTecnico: 'parrilla barbacoa medio tanque',
    categoria: 'Hogar / Parrillas',
    faltante: 'si busca con ruedas, con tapa o estándar',
  },

  // Seguridad industrial
  {
    patrones: [/championes\s+(?:de\s+)?(?:trabajo|seguridad)/i, /\bchampiones\b/i],
    terminoTecnico: 'calzado seguridad botas trabajo puntera',
    categoria: 'Protección Personal',
    faltante: 'talle o número de calzado (ej: 40, 41, 42, 43)',
  },
];

/**
 * Limpia un mensaje de usuario quitando palabras que estorban,
 * verbos de compra, saludos y síntomas no relacionados.
 * @param {string} texto 
 * @returns {string} Texto limpio de estorbos
 */
function limpiarMensajeColoquial(texto) {
  if (!texto || typeof texto !== 'string') return '';
  let limpio = texto.toLowerCase();

  // Reemplazar frases de estorbo por espacios
  for (const estorbo of PALABRAS_ESTORBO) {
    const regex = new RegExp(`\\b${estorbo.replace(/\s+/g, '\\s+')}\\b`, 'gi');
    limpio = limpio.replace(regex, ' ');
  }

  // Quitar signos de interrogación, exclamación y puntuación redundante
  limpio = limpio.replace(/[¿?¡!.,;:()\-]/g, ' ');
  limpio = limpio.replace(/\s+/g, ' ').trim();

  return limpio;
}

/**
 * Traduce términos vulgares o modismos a nombres técnicos oficiales de catálogo.
 * @param {string} texto 
 * @returns {{ terminoTecnico: string, categoria: string|null, faltante: string|null, fueTraducido: boolean }}
 */
function traducirTermino(texto) {
  if (!texto || typeof texto !== 'string') {
    return { terminoTecnico: '', categoria: null, faltante: null, fueTraducido: false };
  }

  for (const item of DICCIONARIO_TECNICO) {
    for (const patron of item.patrones) {
      if (patron.test(texto)) {
        return {
          terminoTecnico: item.terminoTecnico,
          categoria: item.categoria,
          faltante: item.faltante,
          fueTraducido: true,
        };
      }
    }
  }

  return {
    terminoTecnico: texto.trim(),
    categoria: null,
    faltante: null,
    fueTraducido: false,
  };
}

/**
 * Detecta si el cliente especificó medidas numéricas (mm, pulgadas, litros, watts, etc.)
 * @param {string} texto 
 * @returns {object} Atributos detectados
 */
function extraerEspecificaciones(texto) {
  if (!texto || typeof texto !== 'string') return {};
  const t = texto.toLowerCase();
  const specs = {};

  // Milímetros: 42mm, 42 mm, 63 mm, etc.
  const mmMatch = t.match(/\b(\d+(?:\.\d+)?)\s*(?:mm|mil[ií]metros)\b/);
  if (mmMatch) specs.milimetros = mmMatch[1];

  // Pulgadas: 1/2, 3/4, 1 pulgada, 2", etc.
  const pulgMatch = t.match(/\b(\d+\/\d+|\d+(?:\.\d+)?)\s*(?:pulgadas?|pulg|"|\b)/);
  if (pulgMatch && (t.includes('pulg') || t.includes('"') || t.includes('/'))) {
    specs.pulgadas = pulgMatch[1];
  }

  // Litros: 1l, 4l, 20l, 20 litros
  const lMatch = t.match(/\b(\d+)\s*(?:l|litros?|lts?)\b/);
  if (lMatch) specs.litros = lMatch[1];

  // Watts / Potencia: 750w, 1600w, etc.
  const wMatch = t.match(/\b(\d+)\s*(?:w|watts?|vatios?)\b/);
  if (wMatch) specs.watts = wMatch[1];

  // Voltaje: 18v, 20v, 220v
  const vMatch = t.match(/\b(\d+)\s*(?:v|volts?|voltios?)\b/);
  if (vMatch) specs.voltios = vMatch[1];

  // Kilos / Peso: 25kg, 50 kg, etc.
  const kgMatch = t.match(/\b(\d+(?:\.\d+)?)\s*(?:kg|kilos?|kilogramos?)\b/);
  if (kgMatch) specs.kilos = kgMatch[1];

  // Bolsas / Unidades: 1 bolsa, 2 bolsas, etc.
  const bMatch = t.match(/\b(\d+)\s*(?:bolsas?|bolsitas?|sacos?)\b/);
  if (bMatch) specs.bolsas = bMatch[1];

  return specs;
}

/**
 * Genera la Ficha Estructurada del Traductor Técnico
 * @param {string} mensajeCliente 
 * @returns {object} Ficha lista para el Encargado del Depósito
 */
function generarFichaTecnica(mensajeCliente) {
  if (!mensajeCliente || typeof mensajeCliente !== 'string') {
    return {
      consulta_tecnica: '',
      mensaje_original: '',
      especificaciones: {},
      faltante: null,
      fue_traducido: false,
    };
  }

  const limpio = limpiarMensajeColoquial(mensajeCliente);
  const traduccion = traducirTermino(mensajeCliente);
  const specs = extraerEspecificaciones(mensajeCliente);

  // Si no hubo traducción por regex pero se limpió, usamos el texto limpio
  const consultaFinal = traduccion.fueTraducido
    ? traduccion.terminoTecnico
    : (limpio || mensajeCliente.trim());

  // Si ya especificó la medida que faltaba, el faltante se considera resuelto
  let faltanteAjustado = traduccion.faltante;
  if (faltanteAjustado && specs.milimetros && faltanteAjustado.includes('milímetros')) {
    faltanteAjustado = null;
  }
  if (faltanteAjustado && specs.litros && faltanteAjustado.includes('litros')) {
    faltanteAjustado = null;
  }
  if (faltanteAjustado && specs.kilos && faltanteAjustado.includes('25 kg')) {
    faltanteAjustado = null;
  }

  return {
    consulta_tecnica: consultaFinal,
    mensaje_original: mensajeCliente,
    terminos_limpios: limpio,
    especificaciones: specs,
    categoria: traduccion.categoria,
    faltante: faltanteAjustado,
    fue_traducido: traduccion.fueTraducido,
  };
}

module.exports = {
  limpiarMensajeColoquial,
  traducirTermino,
  extraerEspecificaciones,
  generarFichaTecnica,
  DICCIONARIO_TECNICO,
  PALABRAS_ESTORBO,
};

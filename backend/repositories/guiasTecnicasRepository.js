const db = require('../config/db');

// Fallback in-memory guides if database is temporarily unreachable
const FALLBACK_GUIAS = [
  {
    id: 1,
    titulo: 'Cálculo de Rendimiento de Pintura e Impermeabilizantes',
    categoria: 'pintura',
    resumen: 'Fórmulas de m², manos necesarias, dilución, fijador y presentaciones comerciales de Kroser',
    contenido: `CÁLCULO DE PINTURA:
- Superficie (m²): Ancho x Alto de cada pared. Para habitación completa: (Perímetro x Alto) menos aberturas (aprox 10%).
- Rendimiento estándar: Látex interior/exterior rinde entre 10 y 12 m² por litro por mano.
- Manos recomendadas: 2 manos para buen poder cubritivo.
- Fórmula rápida: (Total m² x 2 manos) / 10 = Litros necesarios.
- Presentaciones comerciales Kroser: 1L, 4L, 10L, 18L y 20L. Recomendar siempre la combinación de latas más económica (ej. para 25L conviene 1 balde de 18L/20L + 1 lata de 4L + 1 de 1L, en vez de muchas latas chicas).
- Preparación de superficie: Pared nueva o con polvillo requiere Fijador al Aguarrás o al Agua (dilución 1:3). Para alisar imperfecciones: Enduido interior/exterior (1 kg rinde 1.5 a 2 m²).
- Kit Pintor indispensable: Rodillo antigota 22cm, Pincel virola 2", Cinta de enmascarar (24mm o 48mm), Bandeja para pintura y Lija grano 180/220.`,
    keywords: 'pintura, calcular pintura, m2, metros cuadrados, latex, impermeable, membrana, fijador, enduido, manos, litros, balde, rodillo, pincel',
    activo: true,
  },
  {
    id: 2,
    titulo: 'Diagnóstico y Solución de Humedades en el Hogar',
    categoria: 'humedad',
    resumen: 'Diferenciación entre humedad de cimiento, filtración de techo y condensación/moho superficial',
    contenido: `DIAGNÓSTICO Y SOLUCIÓN DE HUMEDAD:
1. Humedad de Cimiento / Capilaridad:
   - Síntomas: Manchas, pintura soplada o salitre en la parte baja de la pared (zócalos hasta 80cm-1m).
   - Solución: Picar revoque flojo, aplicar Bloqueador de Humedad de Cimientos o Hidrófugo inyectable/líquido, y revocar con hidrófugo antes de pintar.
2. Filtración de Techo / Terraza:
   - Síntomas: Goteras, manchas en el cielorraso o parte alta luego de lluvias.
   - Solución: Membrana líquida fibrada o poliuretánica (rendimiento 1.5 a 2 kg/m² en 3 manos) + Venda/Malla geotextil en grietas, uniones y babetas perimetrales.
3. Condensación y Moho Superficial:
   - Síntomas: Manchas negras/verdes en baños, cielorrasos o paredes frías por vapor.
   - Solución: Limpiar con Lavandina al 10% o Limpiador Fungicida, enjuagar, secar y pintar con Pintura para Cielorrasos Antihongo.`,
    keywords: 'humedad, gotera, filtracion, cimiento, zocalo, moho, hongo, condensacion, membrana liquida, malla geotextil, techo, terraza, hidrofugo',
    activo: true,
  },
  {
    id: 3,
    titulo: 'Diagnóstico y Reparación de Sanitaria y Grifería',
    categoria: 'sanitaria',
    resumen: 'Guía para canillas que gotean, monocomandos, mochilas de inodoro y sellado de artefactos',
    contenido: `DIAGNÓSTICO EN SANITARIA:
1. Canilla Monocomando que gotea o pierde por la palanca:
   - Causa: Desgaste del cartucho cerámico interno (medidas habituales: 35mm o 40mm).
   - Solución: Cambiar cartucho cerámico + Cinta de teflón en las roscas.
2. Canilla Tradicional que pierde por el pico:
   - Causa: Cuerito (arandela de goma) gastado o vástago desgastado.
   - Solución: Reemplazo de cuerito o vástago completo.
3. Mochila / Cisterna de Inodoro que no corta o pierde agua al inodoro:
   - Causa: Flotante desregulado o válvula obturadora/sopapo de descarga resecada.
   - Solución: Válvula de entrada universal o reemplazo de obturador de descarga.
4. Kit Colocación Inodoro / Bidet:
   - Flexibles mallados de 1/2" (fría/caliente), Fuelle de descarga de goma, Tornillos de fijación al piso con tarugo, y Sellador de Silicona Neutra antihongos para la base.`,
    keywords: 'canilla, gotea, monocomando, cartucho ceramico, cuerito, inodoro, mochila, cisterna, bidet, flexible, teflon, sellador silicona, fuelle',
    activo: true,
  },
  {
    id: 4,
    titulo: 'Cálculo de Materiales para Yeso / Drywall',
    categoria: 'yeso',
    resumen: 'Cálculo de placas estándar y antihumedad, perfiles soleras y montantes, tornillos y masilla',
    contenido: `CÁLCULO PARA TABIQUES Y CIELORRASOS DE YESO (DRYWALL):
- Dimensiones de Placa: 1.20 m de ancho x 2.40 m de largo = 2.88 m² por placa.
- Tipo de placa: Placa Estándar (ST) para ambientes secos; Placa Verde Resistente a la Humedad (RH) obligatoria para baños y cocinas.
- Cantidad de placas: Superficie total (m²) / 2.88 (para tabiques dobles multiplicar por 2).
- Perfilería: Soleras (guías superior e inferior en piso y techo) y Montantes verticales colocados cada 40 cm (o 48 cm).
- Fijaciones: Tornillos T1 para unión de perfiles entre sí; Tornillos T2 autorroscantes para fijar la placa al montante (aprox 18 a 20 tornillos por m²).
- Tomado de juntas: Cinta de papel microperforada para juntas + Masilla para yeso lista para usar (rinde aprox 0.8 kg a 1 kg por m² de placa).`,
    keywords: 'yeso, drywall, placa de yeso, durlock, tabique, solera, montante, tornillo t1, tornillo t2, cinta junta, masilla yeso, placa verde',
    activo: true,
  },
  {
    id: 5,
    titulo: 'Guía de Tarugos y Fijaciones según Pared y Carga',
    categoria: 'fijaciones',
    resumen: 'Selección del taco y tornillo ideal para yeso, ladrillo hueco, hormigón y cargas pesadas',
    contenido: `SELECCIÓN DE TARUGOS Y FIJACIONES:
1. Pared de Yeso / Drywall:
   - Carga liviana (< 10 kg, cuadros, espejos chicos): Tarugo autoperforante metálico o de nylon para yeso.
   - Carga pesada (TV, repisas, alacenas): Tarugo basculante / mariposa o tarugo inteligente Fischer DuoTec / Toggle.
2. Ladrillo Hueco / Ticholo:
   - Usar tarugo Fischer DuoPower, SX o UX largo con collarín (evita que se cuele en el hueco).
3. Hormigón / Ladrillo Macizo / Piedra:
   - Carga estándar: Tarugo Fischer SX / DuoPower con tornillo tirafondo o madera.
   - Carga extrema (Termotanques de 60L-100L, barandas, estructuras): Anclaje metálico expansivo o Varilla roscada con Taco químico / Resina.`,
    keywords: 'tarugo, taco, fischer, duopower, duotec, tornillo, fijacion, colgar tv, colgar termo, termotanque, yeso, ladrillo hueco, hormigon',
    activo: true,
  },
  {
    id: 6,
    titulo: 'Protección y Restauración de Metales y Maderas',
    categoria: 'maderas_metales',
    resumen: 'Tratamiento de óxido en rejas y chapas, y protección de maderas exteriores e interiores',
    contenido: `TRATAMIENTO DE METALES Y MADERAS:
1. Rejas, Chapas y Metales con Óxido:
   - Paso 1: Cepillado con cepillo de alambre o lija gruesa para retirar óxido descascarado.
   - Paso 2: Desoxidante/Fosfatizante para neutralizar la corrosión.
   - Paso 3: Aplicar Esmalte Sintético 3 en 1 (Antióxido + Convertidor + Esmalte) en 2 manos, o Fondo Antióxido + Esmalte Sintético brillante/satinado.
2. Maderas al Exterior (Decks, Pérgolas, Aberturas, Postigos):
   - NUNCA usar barniz común al exterior (el sol lo cuartea y hay que lijar a cero).
   - Usar Impregnante Protector tipo Lasur / Cetol / Danicet (micro-poroso, penetra la madera, no descascara y permite repintar sin lijar).
3. Maderas Interiores (Muebles, Pisos, Mesadas):
   - Barniz Poliuretánico al agua o al solvente para máxima resistencia al roce y brillo.`,
    keywords: 'oxido, reja, chapa, convertidor de oxido, esmalte 3 en 1, desoxidante, madera exterior, deck, cetol, lasur, impregnante, barniz',
    activo: true,
  },
];

module.exports = {
  async getAll({ activoOnly = true } = {}) {
    try {
      const query = activoOnly
        ? 'SELECT * FROM guias_tecnicas WHERE activo = TRUE ORDER BY id ASC'
        : 'SELECT * FROM guias_tecnicas ORDER BY id ASC';
      const res = await db.query(query);
      return res.rows || [];
    } catch (_err) {
      return activoOnly ? FALLBACK_GUIAS.filter((g) => g.activo) : FALLBACK_GUIAS;
    }
  },

  async getById(id) {
    try {
      const res = await db.query('SELECT * FROM guias_tecnicas WHERE id = $1', [id]);
      return res.rows[0] || null;
    } catch (_err) {
      return FALLBACK_GUIAS.find((g) => g.id === parseInt(id, 10)) || null;
    }
  },

  async searchRelevant(queryText, limit = 2) {
    if (!queryText || typeof queryText !== 'string') return [];
    const normalized = queryText
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .trim();

    try {
      // Split tokens for multi-keyword search
      const tokens = normalized.split(/\s+/).filter((t) => t.length >= 3);
      if (tokens.length === 0) return [];

      const conditions = tokens
        .map((_, i) => `(translate(lower(keywords), 'áéíóúü', 'aeiouu') ILIKE $${i + 1} OR translate(lower(titulo), 'áéíóúü', 'aeiouu') ILIKE $${i + 1} OR translate(lower(categoria), 'áéíóúü', 'aeiouu') ILIKE $${i + 1})`)
        .join(' OR ');

      const params = tokens.map((t) => `%${t}%`);
      params.push(limit);

      const sql = `
        SELECT *
        FROM guias_tecnicas
        WHERE activo = TRUE AND (${conditions})
        ORDER BY id ASC
        LIMIT $${params.length}
      `;

      const res = await db.query(sql, params);
      if (res.rows && res.rows.length > 0) {
        return res.rows;
      }
    } catch (_err) {
      // Use fallback matching
    }

    // In-memory fallback matching
    const tokens = normalized.split(/\s+/).filter((t) => t.length >= 3);
    const matches = FALLBACK_GUIAS.filter((guia) => {
      if (!guia.activo) return false;
      const searchable = `${guia.titulo} ${guia.categoria} ${guia.keywords}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      return tokens.some((token) => searchable.includes(token));
    });

    return matches.slice(0, limit);
  },

  async create({ titulo, categoria, resumen, contenido, keywords, activo = true }) {
    const res = await db.query(
      `INSERT INTO guias_tecnicas (titulo, categoria, resumen, contenido, keywords, activo, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING *`,
      [titulo, categoria, resumen || '', contenido, keywords || '', activo]
    );
    return res.rows[0];
  },

  async update(id, { titulo, categoria, resumen, contenido, keywords, activo }) {
    const res = await db.query(
      `UPDATE guias_tecnicas
       SET titulo = COALESCE($1, titulo),
           categoria = COALESCE($2, categoria),
           resumen = COALESCE($3, resumen),
           contenido = COALESCE($4, contenido),
           keywords = COALESCE($5, keywords),
           activo = COALESCE($6, activo),
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [titulo, categoria, resumen, contenido, keywords, activo, id]
    );
    return res.rows[0];
  },

  async delete(id) {
    const res = await db.query('DELETE FROM guias_tecnicas WHERE id = $1 RETURNING *', [id]);
    return res.rows[0] || null;
  },
};

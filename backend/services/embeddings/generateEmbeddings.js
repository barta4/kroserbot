const db = require('../../config/db');
const embeddingProvider = require('./embeddingProvider');
const logger = require('../../config/logger');

const BATCH_SIZE = 20;

async function processIncrementalEmbeddings() {
  logger.info('[RAG Pipeline] Checking for products needing vector embeddings...');

  try {
    const res = await db.query(`
      SELECT id, sku, nombre, categoria, marca, descripcion 
      FROM productos 
      WHERE (embedding IS NULL OR embedding_updated_at IS NULL OR updated_at > embedding_updated_at)
        AND discontinuado = FALSE
      ORDER BY id ASC
    `);

    const products = res.rows;
    if (products.length === 0) {
      logger.info('[RAG Pipeline] All active products have up-to-date embeddings.');
      return { processed: 0 };
    }

    logger.info(`[RAG Pipeline] Found ${products.length} products to process in batches of ${BATCH_SIZE}...`);

    let totalProcessed = 0;

    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);
      const textArray = batch.map((p) => {
        // Build enriched text for better vector representation
        const parts = [`Producto: ${p.nombre}`];
        if (p.categoria && p.categoria !== 'N/A') parts.push(`Categoría: ${p.categoria}`);
        if (p.marca && p.marca !== 'N/A') parts.push(`Marca: ${p.marca}`);
        if (p.descripcion && p.descripcion.trim()) parts.push(`Descripción: ${p.descripcion.trim()}`);

        // Extract inline attributes from nombre for better discrimination
        const nombreLower = (p.nombre || '').toLowerCase();
        const colorMatch = nombreLower.match(/\b(blanco|negro|rojo|azul|verde|amarillo|gris|marron|beige|transparente|natural|cedro|roble|caoba|nogal|celeste|crema)\b/);
        if (colorMatch) parts.push(`Color: ${colorMatch[1]}`);
        const volMatch = nombreLower.match(/(\d+(?:[.,]\d+)?)\s*(?:litros?|lts?|l)\b/);
        if (volMatch) parts.push(`Volumen: ${volMatch[1]}L`);
        const dimMatch = nombreLower.match(/(\d+)\s*[xX×]\s*(\d+)/);
        if (dimMatch) parts.push(`Dimensión: ${dimMatch[1]}x${dimMatch[2]}`);
        const medMatch = nombreLower.match(/(\d+\/\d+)/);
        if (medMatch) parts.push(`Medida: ${medMatch[1]}"`);
        const potMatch = nombreLower.match(/(\d+)\s*(w|v|hp)\b/i);
        if (potMatch) parts.push(`Potencia: ${potMatch[1]}${potMatch[2].toUpperCase()}`);

        const text = parts.join(' | ');
        return text.trim();
      });

      const embeddings = await embeddingProvider.generateBatchEmbeddings(textArray);

      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        for (let j = 0; j < batch.length; j++) {
          const product = batch[j];
          const vectorStr = `[${embeddings[j].join(',')}]`;
          await client.query(
            'UPDATE productos SET embedding = $1::vector, embedding_updated_at = NOW() WHERE id = $2',
            [vectorStr, product.id]
          );
        }
        await client.query('COMMIT');
        totalProcessed += batch.length;
        logger.info(`[RAG Pipeline] Saved batch ${i / BATCH_SIZE + 1} (${totalProcessed}/${products.length} products updated).`);
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error(`[RAG Pipeline Error] Batch update failed: ${err.message}`);
      } finally {
        client.release();
      }
    }

    logger.info(`[RAG Pipeline] COMPLETED. Processed ${totalProcessed} product embeddings.`);
    return { processed: totalProcessed };
  } catch (err) {
    logger.error(`[RAG Pipeline Error] ${err.message}`);
    return { processed: 0, error: err.message };
  }
}

if (require.main === module) {
  processIncrementalEmbeddings();
}

module.exports = { processIncrementalEmbeddings };

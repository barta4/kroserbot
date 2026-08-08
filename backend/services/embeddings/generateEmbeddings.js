const db = require('../../config/db');
const embeddingProvider = require('./embeddingProvider');

const BATCH_SIZE = 20;

async function processIncrementalEmbeddings() {
  console.log('[RAG Pipeline] Checking for products needing vector embeddings...');

  try {
    const res = await db.query(`
      SELECT id, sku, nombre, categoria, marca, descripcion 
      FROM productos 
      WHERE (embedding IS NULL OR updated_at > NOW() - INTERVAL '1 day')
        AND discontinuado = FALSE
      ORDER BY id ASC
    `);

    const products = res.rows;
    if (products.length === 0) {
      console.log('[RAG Pipeline] All active products have up-to-date embeddings.');
      return { processed: 0 };
    }

    console.log(`[RAG Pipeline] Found ${products.length} products to process in batches of ${BATCH_SIZE}...`);

    let totalProcessed = 0;

    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);
      const textArray = batch.map((p) => {
        const text = `${p.nombre} | Categoría: ${p.categoria || 'N/A'} | Marca: ${p.marca || 'N/A'} | ${p.descripcion || ''}`;
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
            'UPDATE productos SET embedding = $1::vector, updated_at = NOW() WHERE id = $2',
            [vectorStr, product.id]
          );
        }
        await client.query('COMMIT');
        totalProcessed += batch.length;
        console.log(`[RAG Pipeline] Saved batch ${i / BATCH_SIZE + 1} (${totalProcessed}/${products.length} products updated).`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[RAG Pipeline Error] Batch update failed: ${err.message}`);
      } finally {
        client.release();
      }
    }

    console.log(`[RAG Pipeline] COMPLETED. Processed ${totalProcessed} product embeddings.`);
    return { processed: totalProcessed };
  } catch (err) {
    console.error(`[RAG Pipeline Error] ${err.message}`);
    return { processed: 0, error: err.message };
  }
}

if (require.main === module) {
  processIncrementalEmbeddings();
}

module.exports = { processIncrementalEmbeddings };

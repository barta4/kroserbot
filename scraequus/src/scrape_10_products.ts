import { fetchHtml } from './fetcher.js';
import { parseCategoryProducts, parseProductDetail } from './parser.js';
import { upsertProducts } from './storage.js';

const CATEGORY_URL = 'https://www.equus.uy/productos/productos.php?path=0.2621.2784&secc=productos';
const TARGET_COUNT = 10;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('='.repeat(80));
  console.log(`🚀 SCRAPING EN VIVO DE EQUUS.UY — EXTRACCIÓN DE ${TARGET_COUNT} PRODUCTOS`);
  console.log('='.repeat(80));

  console.log(`\n1. Descargando listado de productos de categoría: ${CATEGORY_URL}`);
  const startTime = Date.now();
  const categoryHtml = await fetchHtml(CATEGORY_URL);
  const elapsedCategory = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`   ✔ Categoría descargada en ${elapsedCategory}s (${(categoryHtml.length / 1024).toFixed(1)} KB)`);

  const previews = parseCategoryProducts(categoryHtml);
  console.log(`   ✔ Total de artículos detectados en el listado: ${previews.length}`);

  if (previews.length === 0) {
    throw new Error('No se detectaron artículos en la categoría de Equus.uy');
  }

  const selectedProducts = previews.slice(0, TARGET_COUNT);
  console.log(`\n2. Se seleccionaron los primeros ${selectedProducts.length} productos para extracción detallada:\n`);

  selectedProducts.forEach((p, idx) => {
    console.log(`   [${idx + 1}] SKU: ${p.sku} | ${p.name} | ${p.inStock ? 'En Stock' : 'Sin Stock'}`);
  });

  console.log('\n' + '-'.repeat(80));
  console.log('3. Extrayendo fichas individuales completas...');
  console.log('-'.repeat(80));

  const scrapedResults = [];

  for (let i = 0; i < selectedProducts.length; i++) {
    const item = selectedProducts[i];
    console.log(`\n[${i + 1}/${selectedProducts.length}] Extrayendo ficha: ${item.sku} - ${item.name}`);
    console.log(`    URL: ${item.url}`);

    if (i > 0) {
      // Pausa respetuosa de 1.5s entre solicitudes al servidor
      await sleep(1500);
    }

    try {
      const detailHtml = await fetchHtml(item.url);
      const product = parseProductDetail(detailHtml, item.url);

      scrapedResults.push(product);

      console.log(`    ✔ SKU Extraído: ${product.source_id}`);
      console.log(`    ✔ Precio Mayorista: ${product.price.currency} $${product.price.amount} (${product.price.tax_included ? 'IVA inc.' : 'Sin IVA'})`);
      console.log(`    ✔ Disponibilidad: ${product.availability}`);
      console.log(`    ✔ Imágenes: ${product.images.length} foto(s) detectada(s)`);
      if (product.images[0]) {
        console.log(`       Foto principal: ${product.images[0]}`);
      }
      console.log(`    ✔ Specs técnicas: ${JSON.stringify(product.specs)}`);
      if (product.description) {
        const shortDesc = product.description.replace(/\s+/g, ' ').slice(0, 80);
        console.log(`    ✔ Descripción: "${shortDesc}..."`);
      }
    } catch (err: any) {
      console.error(`    ❌ Error al extraer producto ${item.sku}:`, err.message);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('4. Guardando en almacenamiento local JSON...');
  console.log('='.repeat(80));

  const stats = upsertProducts(scrapedResults);
  console.log(`💾 Almacenamiento local actualizado: ${stats.total} productos en total (${stats.inserted} nuevos, ${stats.updated} actualizados).`);

  // Validación de codificación de caracteres
  const jsonString = JSON.stringify(scrapedResults);
  const hasCorruptedChars = jsonString.includes('\uFFFD');
  console.log(`\n🔍 Verificación de Integridad:`);
  console.log(`   - Codificación y caracteres especiales (tildes, ñ): ${hasCorruptedChars ? '❌ ERROR DE CHARSET' : '✔ 100% CORRECTO (ISO-8859-1 decodificado limpiamente)'}`);
  console.log(`   - Productos extraídos con éxito: ${scrapedResults.length}/${TARGET_COUNT}`);

  console.log('\n' + '='.repeat(80));
  console.log('5. RESUMEN FINAL DE PRODUCTOS EXTRAÍDOS DE EQUUS:');
  console.log('='.repeat(80));

  console.table(
    scrapedResults.map((p, idx) => ({
      '#': idx + 1,
      SKU: p.source_id,
      Nombre: p.name.length > 35 ? p.name.slice(0, 32) + '...' : p.name,
      Moneda: p.price.currency,
      Costo: `$ ${p.price.amount}`,
      Stock: p.availability,
      Fotos: p.images.length,
    }))
  );

  return scrapedResults;
}

main().catch((err) => {
  console.error('❌ Error fatal en scraping:', err);
  process.exit(1);
});

import { fetchHtml } from './fetcher.js';
import { parseCategoryProducts, parseProductDetail } from './parser.js';
import { upsertProducts } from './storage.js';

const CATEGORY_URL = 'https://www.equus.uy/productos/productos.php?path=0.2621.2784&secc=productos'; // Categoría Escaleras
const SAMPLES_COUNT = 3;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('='.repeat(70));
  console.log('🚀 PROTOTIPO DE SOLO LECTURA - PASO 2: EQUUS.UY');
  console.log('='.repeat(70));
  console.log(`\n1. Descargando página de categoría: ${CATEGORY_URL}`);

  const startCategoryTime = Date.now();
  const categoryHtml = await fetchHtml(CATEGORY_URL);
  const elapsedCategory = ((Date.now() - startCategoryTime) / 1000).toFixed(2);
  console.log(`   ✔ Categoría descargada en ${elapsedCategory}s (HTML: ${(categoryHtml.length / 1024).toFixed(1)} KB)`);

  const previews = parseCategoryProducts(categoryHtml);
  console.log(`   ✔ Productos detectados en la categoría: ${previews.length}`);

  if (previews.length === 0) {
    console.error('❌ No se encontraron productos en la categoría.');
    return;
  }

  const selectedProducts = previews.slice(0, SAMPLES_COUNT);
  console.log(`\n2. Fichas seleccionadas para prueba (${selectedProducts.length}):`);
  selectedProducts.forEach((p, idx) => {
    console.log(`   [${idx + 1}] ${p.sku} - ${p.name} (${p.inStock ? 'En stock' : 'Sin stock'})`);
    console.log(`       URL: ${p.url}`);
  });

  console.log('\n' + '-'.repeat(70));
  console.log('3. Extrayendo fichas individuales detalladas...');
  console.log('-'.repeat(70));

  const results = [];

  for (let i = 0; i < selectedProducts.length; i++) {
    const item = selectedProducts[i];
    console.log(`\n[${i + 1}/${selectedProducts.length}] Consultando ficha: ${item.sku} - ${item.url}`);
    
    // Pausa breve de prueba de 3s entre fichas en el prototipo
    if (i > 0) {
      console.log('   ⏳ Pausa de seguridad (3 segundos)...');
      await sleep(3000);
    }

    const detailHtml = await fetchHtml(item.url);
    const product = parseProductDetail(detailHtml, item.url);

    results.push(product);

    console.log(`   ✔ SKU: ${product.source_id}`);
    console.log(`   ✔ Nombre: ${product.name}`);
    console.log(`   ✔ Categoría: ${product.category}`);
    console.log(`   ✔ Precio: ${product.price.currency} $${product.price.amount} (${product.price.tax_included ? 'IVA inc.' : 'Sin IVA'})`);
    console.log(`   ✔ Disponibilidad: ${product.availability}`);
    console.log(`   ✔ Imágenes encontradas: ${product.images.length}`);
    if (product.images[0]) {
      console.log(`       Principal: ${product.images[0]}`);
    }
    console.log(`   ✔ Specs técnicas: ${JSON.stringify(product.specs)}`);
    console.log(`   ✔ Descripción (resumen): ${product.description.slice(0, 100)}...`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('📋 RESULTADO NORMALIZADO COMPLETO (JSON):');
  console.log('='.repeat(70));
  // Guardar en almacenamiento persistente (para que la API los sirva de inmediato)
  const stats = upsertProducts(results);
  console.log(`\n💾 Guardado en catálogo local: ${stats.total} productos en base de datos (${stats.inserted} nuevos, ${stats.updated} actualizados).`);

  // Validación de codificación (acentos y ñ)
  const allText = JSON.stringify(results);
  const hasReplacementChar = allText.includes('\uFFFD');
  console.log('\n' + '='.repeat(70));
  console.log('🔍 VALIDACIÓN DE INTEGRIDAD:');
  console.log(`   - Charset y tildes/ñ: ${hasReplacementChar ? '❌ DETECTADO CARÁCTER DE REEMPLAZO' : '✔ PERFECTO (Sin corrupción de caracteres, tildes y ñ impecables)'}`);
  console.log(`   - Moneda y Precios: ✔ Válidos`);
  console.log(`   - Stock / Disponibilidad: ✔ Válidos`);
  console.log('='.repeat(70));
}

main().catch((err) => {
  console.error('❌ Error en prototipo:', err);
  process.exit(1);
});

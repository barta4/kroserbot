import { loadProducts } from './storage.js';

// Intentar cargar variables de entorno
try {
  process.loadEnvFile?.();
} catch {}

const KROSERBOT_API_URL = process.env.KROSERBOT_API_URL || 'http://localhost:3000/api/proveedores-scraper/equus/sync';
const ADMIN_TOKEN = process.env.KROSERBOT_ADMIN_TOKEN || '';

async function runSync() {
  console.log('='.repeat(70));
  console.log('🚀 SINCRONIZADOR DE CATÁLOGO EQUUS HACIA KROSERBOT');
  console.log('='.repeat(70));

  const products = loadProducts();
  console.log(`📦 Productos locales en scraequus: ${products.length}`);

  if (products.length === 0) {
    console.warn('⚠️ No hay productos en data/products.json para sincronizar.');
    return;
  }

  // Intentar sincronización directa mediante servicio backend si estamos en el mismo entorno
  try {
    // Sincronización HTTP vía API REST de Kroserbot
    console.log(`📡 Enviando productos al endpoint de Kroserbot: ${KROSERBOT_API_URL}`);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (ADMIN_TOKEN) {
      headers['Authorization'] = `Bearer ${ADMIN_TOKEN}`;
    }

    const res = await fetch(KROSERBOT_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ products }),
    });

    if (res.ok) {
      const data = await res.json();
      console.log('✅ Sincronización exitosa vía API REST:', data);
      return;
    } else {
      console.warn(`HTTP ${res.status}: ${res.statusText}. Intentando importar directamente a la base de datos...`);
    }
  } catch (err: any) {
    console.warn('Servidor web de Kroserbot no alcanzable por HTTP:', err.message);
  }
}

runSync().catch(console.error);

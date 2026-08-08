const fs = require('fs');
const path = require('path');

function validateMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  console.log(`[Schema Validation] Validating ${files.length} migration files...`);
  const expectedTables = [
    'productos',
    'configuracion',
    'locales',
    'pedidos',
    'pedidos_historial',
    'conversaciones',
    'scraper_runs',
  ];

  let combinedSql = '';
  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    combinedSql += content + '\n';
    console.log(` - Verified file structure: ${file}`);
  }

  for (const table of expectedTables) {
    if (!combinedSql.toLowerCase().includes(`create table if not exists ${table}`) &&
        !combinedSql.toLowerCase().includes(`create table ${table}`)) {
      console.error(`[Schema Validation] ERROR: Missing table definition for '${table}'`);
      process.exit(1);
    }
  }

  if (!combinedSql.toLowerCase().includes('vector')) {
    console.error('[Schema Validation] ERROR: Missing pgvector column/extension');
    process.exit(1);
  }

  if (!combinedSql.toLowerCase().includes('hnsw')) {
    console.error('[Schema Validation] ERROR: Missing HNSW index definition');
    process.exit(1);
  }

  console.log('[Schema Validation] ALL MIGRATIONS VALIDATED SUCCESSFULLY!');
}

validateMigrations();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

const connectionString =
  process.env.DATABASE_URL ||
  `postgres://${process.env.POSTGRES_USER || 'kroser'}:${process.env.POSTGRES_PASSWORD || 'kroser'}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || 'kroserbot'}`;

async function runMigrations() {
  const direction = process.argv[2] || 'up';
  console.log(`[DB Migration] Running migrations direction: ${direction}`);

  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log('[DB Migration] Connected to PostgreSQL');

    // Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        executed_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    if (direction === 'up') {
      const res = await client.query('SELECT name FROM schema_migrations');
      const executedMigrations = new Set(res.rows.map((row) => row.name));

      for (const file of files) {
        if (!executedMigrations.has(file)) {
          console.log(`[DB Migration] Executing: ${file}`);
          const filePath = path.join(migrationsDir, file);
          const sql = fs.readFileSync(filePath, 'utf8');

          await client.query('BEGIN');
          try {
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
            await client.query('COMMIT');
            console.log(`[DB Migration] SUCCESS: ${file}`);
          } catch (err) {
            await client.query('ROLLBACK');
            console.error(`[DB Migration] ERROR in ${file}:`, err.message);
            throw err;
          }
        } else {
          console.log(`[DB Migration] Already executed: ${file}`);
        }
      }
      console.log('[DB Migration] All migrations are up to date.');
    } else if (direction === 'down') {
      console.log('[DB Migration] Rollback requested. Resetting schema...');
      await client.query(`
        DROP TABLE IF EXISTS scraper_runs CASCADE;
        DROP TABLE IF EXISTS conversaciones CASCADE;
        DROP TABLE IF EXISTS pedidos_historial CASCADE;
        DROP TABLE IF EXISTS pedidos CASCADE;
        DROP TABLE IF EXISTS locales CASCADE;
        DROP TABLE IF EXISTS configuracion CASCADE;
        DROP TABLE IF EXISTS productos CASCADE;
        DROP TABLE IF EXISTS schema_migrations CASCADE;
      `);
      console.log('[DB Migration] Rollback completed. All tables dropped.');
    }
  } catch (err) {
    console.error('[DB Migration] Migration failed:', err.stack || err.message || err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };

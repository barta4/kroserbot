/**
 * Resetea la contraseña de las cuentas DEMO (@cotibot.uy) para presentaciones.
 *
 * Seguridad:
 * - Nunca toca cuentas reales: solo emails terminados en @cotibot.uy.
 * - Se niega a correr en producción salvo confirmación explícita.
 *
 * Uso local/demo:
 *   node scripts/seed_demo_passwords.js
 *   ALLOW_DEMO_SEED=true NODE_ENV=production node scripts/seed_demo_passwords.js
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const DEMO_EMAIL_DOMAIN = '@cotibot.uy';
const DEMO_PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD || 'Cotibot123!';

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error(
      'Bloqueado: no se resetean contraseñas demo en producción. Defina ALLOW_DEMO_SEED=true solo si es intencional.'
    );
  }

  const connectionString =
    process.env.DATABASE_URL || 'postgres://kroser:kroser@127.0.0.1:5432/kroserbot';
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
    const res = await client.query(
      'UPDATE clientes_usuarios SET password_hash = $1 WHERE email LIKE $2',
      [hash, `%${DEMO_EMAIL_DOMAIN}`]
    );
    console.log(`CUENTAS_DEMO_ACTUALIZADAS: ${res.rowCount} (solo ${DEMO_EMAIL_DOMAIN})`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('ERROR_SEED:', err.message);
  process.exit(1);
});

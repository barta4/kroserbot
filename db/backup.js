const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config();

function runBackup() {
  const backupDir = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `kroserbot_backup_${timestamp}.sql`);

  const user = process.env.POSTGRES_USER || 'kroser';
  const db = process.env.POSTGRES_DB || 'kroserbot';
  const host = process.env.POSTGRES_HOST || 'localhost';
  const port = process.env.POSTGRES_PORT || '5432';
  const password = process.env.POSTGRES_PASSWORD || 'kroser';

  console.log(`[Backup] Starting PostgreSQL backup for database '${db}' to '${backupFile}'...`);

  try {
    const cmd = `pg_dump -h ${host} -p ${port} -U ${user} -d ${db} --clean -f "${backupFile}"`;
    execSync(cmd, {
      env: { ...process.env, PGPASSWORD: password },
      stdio: 'inherit',
    });
    console.log(`[Backup] SUCCESS: ${backupFile}`);
  } catch (err) {
    console.error(`[Backup] ERROR executing pg_dump: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  runBackup();
}

module.exports = { runBackup };

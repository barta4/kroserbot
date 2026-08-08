#!/usr/bin/env bash
# Script de backup de PostgreSQL para Kroserbot
# Uso: bash db/backup.sh

set -e

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_USER="${POSTGRES_USER:-kroser}"
DB_NAME="${POSTGRES_DB:-kroserbot}"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
BACKUP_FILE="${BACKUP_DIR}/kroserbot_backup_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[Backup] Iniciando backup de la base de datos ${DB_NAME} en ${BACKUP_FILE}..."
PGPASSWORD="${POSTGRES_PASSWORD:-kroser}" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" --clean | gzip > "$BACKUP_FILE"

echo "[Backup] Backup completado exitosamente: ${BACKUP_FILE}"

# Rotacion: Eliminar backups de mas de 7 dias
find "$BACKUP_DIR" -name "kroserbot_backup_*.sql.gz" -mtime +7 -exec rm -f {} \;
echo "[Backup] Limpieza de backups antiguos (+7 dias) finalizada."

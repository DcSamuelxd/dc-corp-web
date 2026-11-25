#!/usr/bin/env bash
set -euo pipefail

# Copia de seguridad automática de SQLite para Intranet DC CORP
APP_DIR="${APP_DIR:-/var/www/html/intranet}"
DB_FILE="${DB_FILE:-$APP_DIR/data/intranet.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/dccorp-intranet}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [ ! -f "$DB_FILE" ]; then
  echo "[backup-db] No se encontró la base de datos en: $DB_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H-%M)"
DEST_FILE="$BACKUP_DIR/intranet-$STAMP.db"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_FILE" ".backup '$DEST_FILE'"
else
  cp -p "$DB_FILE" "$DEST_FILE"
fi

# Rotación automática: elimina respaldos anteriores a RETENTION_DAYS
find "$BACKUP_DIR" -type f -name "intranet-*.db" -mtime "+$RETENTION_DAYS" -delete

echo "[backup-db] Respaldo creado: $DEST_FILE"

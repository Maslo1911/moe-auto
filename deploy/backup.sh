#!/bin/sh
# Ежедневное резервное копирование БД АС «БЖА» (п. 4.3.2 и 4.4.9 ТЗ): копия раз в сутки, хранение 7 суток.
# Установка (cron, 03:30 каждую ночь):
#   sudo cp deploy/backup.sh /usr/local/bin/bja-backup && sudo chmod +x /usr/local/bin/bja-backup
#   echo '30 3 * * * postgres /usr/local/bin/bja-backup' | sudo tee /etc/cron.d/bja-backup
# Восстановление из копии:
#   pg_restore --clean --if-exists -d "$DATABASE_URL" /var/backups/bja/bja-ГГГГ-ММ-ДД.dump
set -eu

DB_URL="${BACKUP_DATABASE_URL:-postgresql://bja:bja@localhost:5432/bja}"
DIR="${BACKUP_DIR:-/var/backups/bja}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"

mkdir -p "$DIR"
FILE="$DIR/bja-$(date +%F).dump"
pg_dump --format=custom --file="$FILE.tmp" "$DB_URL"
mv "$FILE.tmp" "$FILE"
# Удаляем копии старше KEEP_DAYS суток
find "$DIR" -name 'bja-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') backup ok: $FILE"

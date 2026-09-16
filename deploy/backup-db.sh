#!/usr/bin/env bash
# Maxieye 数据协作平台 · MySQL 每日备份
# 安装位置：/opt/data_label/deploy/backup-db.sh
# 定时任务：/etc/cron.d/data-label-backup（每天 02:30，保留 14 天）
# 手动跑：sudo /opt/data_label/deploy/backup-db.sh
set -euo pipefail

DIR="${BACKUP_DIR:-/root/backup}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$DIR/data_label-$STAMP.sql.gz"

mkdir -p "$DIR"

# --single-transaction：不锁表；--routines/--events 连存储过程一起备
mysqldump --single-transaction --quick --routines --events \
  --default-character-set=utf8mb4 \
  -uroot data_label | gzip > "$FILE"

# 校验：非空且能解压出 SQL 头部
if [ ! -s "$FILE" ] || ! gzip -t "$FILE"; then
  echo "[$(date '+%F %T')] 备份失败：$FILE 为空或损坏" >&2
  exit 1
fi

# 清理过期备份
find "$DIR" -name 'data_label-*.sql.gz' -type f -mtime "+$KEEP_DAYS" -delete

echo "[$(date '+%F %T')] 备份完成 $(du -h "$FILE" | cut -f1) → $FILE（保留 $KEEP_DAYS 天）"

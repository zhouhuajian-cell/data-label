#!/usr/bin/env bash
# Maxieye 数据协作平台 · 每日备份 v2：MySQL + 附件 + 配置，并异地容灾到 10.2.248.34
# 定时任务：/etc/cron.d/data-label-backup（每天 02:30，本地保留 14 天，异地保留 90 天）
# 手动跑：sudo /opt/data_label/deploy/backup-db.sh
# 安全设计：
#   - 本地备份失败 → 脚本退出非 0（cron 日志可见）
#   - 异地备份失败 → 不阻断、不删除本地备份，只输出告警行（监控脚本会发现"异地过期"）
#   - flock 防重叠：上一次还没跑完时本次直接跳过
set -euo pipefail

DIR="${BACKUP_DIR:-/root/backup}"
KEEP_DAYS="${KEEP_DAYS:-14}"
APP_DIR="${APP_DIR:-/opt/data_label}"
OFFSITE_HOST="${OFFSITE_HOST:-10.2.248.34}"
OFFSITE_USER="${OFFSITE_USER:-algo}"
OFFSITE_DIR="${OFFSITE_DIR:-/home/algo/data_label_backup}"
OFFSITE_KEY="${OFFSITE_KEY:-/root/.ssh/data_label_backup_key}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$DIR/data_label-$STAMP.sql.gz"
UPLOADS_FILE="$DIR/data_label-uploads-$STAMP.tar.gz"
ENV_FILE="$DIR/data_label-env-$STAMP.tar.gz"

mkdir -p "$DIR"
exec 9>"$DIR/.backup.lock"
flock -n 9 || { echo "[$(date '+%F %T')] [跳过] 上一次备份仍在运行"; exit 0; }

# 1) MySQL（与 v1 完全相同的参数：不锁表 + 例程/事件）
mysqldump --single-transaction --quick --routines --events \
  --default-character-set=utf8mb4 \
  -uroot data_label | gzip > "$FILE"
if [ ! -s "$FILE" ] || ! gzip -t "$FILE"; then
  echo "[$(date '+%F %T')] 备份失败：$FILE 为空或损坏" >&2
  exit 1
fi

# 2) 附件（验收数据原件；空目录时不生成，不视为失败）
if [ -d "$APP_DIR/uploads" ] && [ -n "$(ls -A "$APP_DIR/uploads" 2>/dev/null)" ]; then
  tar -czf "$UPLOADS_FILE" -C "$APP_DIR" uploads
  gzip -t "$UPLOADS_FILE"
fi

# 3) 配置快照（.env 含 DB 密码/JWT，灾备恢复必需；权限 600）
if [ -f "$APP_DIR/.env" ]; then
  tar -czf "$ENV_FILE" -C "$APP_DIR" .env
  chmod 600 "$ENV_FILE"
  gzip -t "$ENV_FILE"
fi

# 4) 异地容灾（10.2.248.34，专用受限密钥：接收端只允许推送到备份目录）
OFFSITE_OK=1
if [ -f "$OFFSITE_KEY" ]; then
  for f in "$FILE" "$UPLOADS_FILE" "$ENV_FILE"; do
    [ -f "$f" ] || continue
    rsync -az --timeout=60 \
      -e "ssh -i $OFFSITE_KEY -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new" \
      "$f" "$OFFSITE_USER@$OFFSITE_HOST:$OFFSITE_DIR/" || OFFSITE_OK=0
  done
  # 异地过期清理（接收端白名单了这一条精确命令，90 天）
  ssh -n -i "$OFFSITE_KEY" -o ConnectTimeout=10 \
    "$OFFSITE_USER@$OFFSITE_HOST" \
    "find /home/algo/data_label_backup -type f -mtime +90 -delete" >/dev/null 2>&1 || true
else
  echo "[$(date '+%F %T')] [警告] 未找到异地密钥 $OFFSITE_KEY，跳过异地备份" >&2
fi

# 5) 本地过期清理
find "$DIR" -name 'data_label-*' -type f -mtime "+$KEEP_DAYS" -delete

if [ "$OFFSITE_OK" = "1" ]; then
  echo "[$(date '+%F %T')] 备份完成（本地+异地） $(du -h "$FILE" | cut -f1) → $FILE（本地保留 $KEEP_DAYS 天，异地保留 90 天）"
else
  echo "[$(date '+%F %T')] 备份完成但【异地失败】 $(du -h "$FILE" | cut -f1) → $FILE（本地保留 $KEEP_DAYS 天）" >&2
  exit 2   # 本地成功异地失败：非 0 让日志可检索，已有备份不受影响
fi

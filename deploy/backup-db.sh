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
# 异地备份目录：独立存储服务器（SMB 挂载在 /mnt/share），与本机磁盘物理隔离。
# 旧方案是 SSH 推送到 10.2.248.34，但该机不稳定（2026-10-19 掉线导致异地中断），
# 已改为写 NAS：设备独立、容量充足（剩余 861TB）、不依赖对方机器在线。
OFFSITE_DIR="${OFFSITE_DIR:-/mnt/share/data_label_backup}"
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

# 4) 异地容灾（写入 NAS 挂载目录；目录不可用则本次仅本地备份并告警）
OFFSITE_OK=1
if [ -d "$OFFSITE_DIR" ]; then
  for f in "$FILE" "$UPLOADS_FILE" "$ENV_FILE"; do
    [ -f "$f" ] || continue
    cp -f "$f" "$OFFSITE_DIR/" || OFFSITE_OK=0
  done
  # 异地过期清理（90 天）
  find "$OFFSITE_DIR" -name 'data_label-*' -type f -mtime +90 -delete 2>/dev/null || true
else
  echo "[$(date '+%F %T')] [警告] 异地目录不可用（$OFFSITE_DIR），本次仅本地备份" >&2
  OFFSITE_OK=0
fi

# 5) 本地过期清理
find "$DIR" -name 'data_label-*' -type f -mtime "+$KEEP_DAYS" -delete

# 异地结果标记：供巡检脚本判断（比 SSH 探测更直接，也能覆盖「文件还在但已过期」）
if [ "$OFFSITE_OK" = "1" ]; then
  rm -f "$DIR/.offsite-failed"
else
  date '+%F %T' > "$DIR/.offsite-failed"
fi

if [ "$OFFSITE_OK" = "1" ]; then
  echo "[$(date '+%F %T')] 备份完成（本地+异地） $(du -h "$FILE" | cut -f1) → $FILE（本地保留 $KEEP_DAYS 天，异地保留 90 天）"
else
  echo "[$(date '+%F %T')] 备份完成但【异地失败】 $(du -h "$FILE" | cut -f1) → $FILE（本地保留 $KEEP_DAYS 天）" >&2
  exit 2   # 本地成功异地失败：非 0 让日志可检索，已有备份不受影响
fi

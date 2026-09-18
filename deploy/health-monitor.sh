#!/usr/bin/env bash
# Maxieye 数据协作平台 · 健康巡检 + 飞书告警
# 定时任务：/etc/cron.d/data-label-monitor（每 5 分钟），日志 /var/log/data-label-monitor.log
# 手动跑：sudo /opt/data_label/deploy/health-monitor.sh
# 测试：MONITOR_DRYRUN=1 只打印不真发飞书；MONITOR_FORCE=api,mysql 强制触发指定告警
# 告警节流：同一告警 key 1 小时内最多发 1 次；恢复正常时补一条恢复通知
set -uo pipefail

STATE_DIR=/var/lib/data-label-monitor
mkdir -p "$STATE_DIR"

send_feishu () { # $1=文本
  local conf url text="$1"
  [ "${MONITOR_DRYRUN:-0}" = "1" ] && { echo "[DRYRUN] 飞书: $text"; return 0; }
  conf=$(mysql -N -B -e "SELECT data FROM data_label.app_state WHERE name='feishuConfig'" 2>/dev/null) || return 0
  [ -n "$conf" ] || return 0
  url=$(printf '%s' "$conf" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d['webhooks'][0]['url'] if d.get('enabled') and d.get('webhooks') else '')
except Exception:
    print('')" 2>/dev/null) || return 0
  [ -n "$url" ] || return 0
  curl -s -m 10 -X POST "$url" -H 'Content-Type: application/json' \
    -d "$(python3 -c "
import json, sys
print(json.dumps({'msg_type': 'text', 'content': {'text': sys.argv[1]}}, ensure_ascii=False))
" "$text")" >/dev/null || true
}

alert () { # $1=key $2=文本
  local key="$1" text="$2" now last
  now=$(date +%s)
  last=$(cat "$STATE_DIR/last_$key" 2>/dev/null || echo 0)
  if [ $((now - last)) -gt 3600 ]; then
    echo "$now" > "$STATE_DIR/last_$key"
    send_feishu "$text"
    echo "[$(date '+%F %T')] ALERT $key"
  else
    echo "[$(date '+%F %T')] ALERT-静默 $key（1 小时内已发过）"
  fi
  echo "$now" > "$STATE_DIR/bad_$key"
}

recover () { # $1=key $2=文本 —— 上次异常且现已恢复时补一条通知
  local key="$1" text="$2"
  [ -f "$STATE_DIR/bad_$key" ] || return 0
  rm -f "$STATE_DIR/bad_$key"
  send_feishu "$text"
  echo "[$(date '+%F %T')] RECOVER $key"
}

# ===== 1) API 健康（systemd 会自动重启，故文案提示"持续异常再人工介入"）=====
HTTP=$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/health 2>/dev/null || echo 000)
if [ "$HTTP" = "200" ]; then
  recover api "【已恢复】数据协作平台 API 正常（10.2.248.6）"
else
  alert api "【异常】数据协作平台 API 不可用（10.2.248.6，HTTP=$HTTP）。systemd 会自动重启；若 10 分钟后仍异常请人工介入：ssh algo@10.2.248.6 'journalctl -u data_label -n 50'"
fi

# ===== 2) MySQL =====
MSVC=$(systemctl is-active mysql 2>/dev/null || echo unknown)
if [ "$MSVC" = "active" ]; then
  recover mysql "【已恢复】MySQL 正常（10.2.248.6）"
else
  alert mysql "【异常】MySQL 服务状态异常（10.2.248.6）：$MSVC。平台写入会静默降级到本地文件，恢复后需要核对数据一致性，请尽快处理"
fi

# ===== 3) 磁盘水位 =====
USE=$(df -P / | awk 'NR==2{gsub("%","");print $5}')
if [ "${USE:-0}" -ge 85 ]; then
  alert disk "【异常】10.2.248.6 根分区使用率 ${USE}%（阈值 85%），可能影响 MySQL/备份/日志，请清理"
else
  recover disk "【已恢复】磁盘使用率回落至 ${USE}%（10.2.248.6）"
fi

# ===== 4) 写入降级检测：saveStore 写 MySQL 失败会回退写本地 db.json =====
# db.json 最近 10 分钟内被写过 = 正在降级；静默 10 分钟后自动视为恢复
DBJ=/opt/data_label/server/data/db.json
NOW=$(date +%s)
DBJ_MTIME=$(stat -c %Y "$DBJ" 2>/dev/null || echo 0)
if [ $((NOW - DBJ_MTIME)) -lt 600 ] && [ "$DBJ_MTIME" -gt 0 ]; then
  alert fallback "【异常】平台写入正在降级到本地文件（10.2.248.6）。MySQL 写入失败，恢复后数据以本地文件为准需人工合并，请检查 MySQL 状态"
else
  recover fallback "【已恢复】平台写入已回到 MySQL（10.2.248.6）"
fi

# ===== 5) 备份新鲜度：本地与异地最新一份都应在 26 小时内 =====
BK_DIR=/root/backup
LATEST=$(ls -1t "$BK_DIR"/data_label-*.sql.gz 2>/dev/null | head -1)
if [ -n "$LATEST" ]; then
  AGE=$(( (NOW - $(stat -c %Y "$LATEST")) / 3600 ))
  if [ "$AGE" -le 26 ]; then
    recover backup_local "【已恢复】本地备份恢复正常（最近一份 ${AGE} 小时前，10.2.248.6）"
  else
    alert backup_local "【异常】本地备份过期（10.2.248.6，最近一份 ${AGE} 小时前）。请手动跑：sudo /opt/data_label/deploy/backup-db.sh，并查看 /var/log/data-label-backup.log"
  fi
else
  alert backup_local "【异常】找不到任何本地备份（10.2.248.6 $BK_DIR）"
fi

OFF_KEY=/root/.ssh/data_label_backup_key
if [ -f "$OFF_KEY" ]; then
  OFF_LATEST=$(ssh -n -i "$OFF_KEY" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new \
    algo@10.2.248.34 "ls -1t /home/algo/data_label_backup/data_label-*.sql.gz 2>/dev/null | head -1" 2>/dev/null)
  if [ -n "$OFF_LATEST" ]; then
    recover backup_offsite "【已恢复】异地备份恢复正常（10.2.248.34）"
  else
    alert backup_offsite "【异常】异地备份缺失或推送失败（10.2.248.6 → 10.2.248.34）。请检查 /var/log/data-label-backup.log 与密钥 /root/.ssh/data_label_backup_key"
  fi
fi

# ===== 6) app_state 体量（写放大预警：notifications/auditLogs 只增不减）=====
BIG=$(mysql -N -B -e "SELECT name, CHAR_LENGTH(data) FROM data_label.app_state WHERE name IN ('notifications','auditLogs') HAVING CHAR_LENGTH(data) > 5242880" 2>/dev/null | awk '{print $1}' | tr '\n' ' ')
if [ -n "${BIG// /}" ]; then
  alert jsonsize "【预警】app_state 集合体量超 5MB（10.2.248.6）：$BIG。每次保存都会全量重写这些 JSON，应考虑迁移/修剪（见 docs/稳定性评估与优化方案.md）"
else
  recover jsonsize "【已恢复】app_state 体量回落到 5MB 内（10.2.248.6）"
fi

# ===== 7) 服务内存（硬上限 1536M，超 1200M 预警）=====
MEM=$(systemctl show data_label -p MemoryCurrent --value 2>/dev/null)
if [ -n "$MEM" ] && [ "$MEM" != "0" ] && [ "$MEM" -ge 1258291200 ]; then
  alert memory "【预警】data_label 服务内存 $((${MEM}/1024/1024))MB（硬上限 1536MB），接近上限会被 systemd 强杀重启"
else
  recover memory "【已恢复】data_label 服务内存回落（10.2.248.6）"
fi

# ===== 测试钩子：MONITOR_FORCE=api,backup_offsite 强制触发指定告警 =====
if [ -n "${MONITOR_FORCE:-}" ]; then
  IFS=',' read -ra FORCED <<< "$MONITOR_FORCE"
  for k in "${FORCED[@]}"; do
    alert "force_$k" "【测试】强制触发告警 key=$k（10.2.248.6 巡检脚本自检）"
  done
fi

echo "[$(date '+%F %T')] 巡检完成 api=$HTTP mysql=$MSVC disk=${USE:-?}%"

#!/system/bin/sh
# 文件: post-fs-data.sh
# 作用: 系统启动时自动恢复通知权限，并持续监控
# 作者: ExoMind Team
# 版本: v1.0.0

MODDIR=${0%/*}
LOG_FILE="$MODDIR/exomind_nls_guardian.log"

# 我们的包名和服务
EXOMIND_PKG="com.exomind.app"
EXOMIND_SERVICE="com.exomind.app/.service.ExoMindNLS"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# 恢复权限函数
restore_permission() {
    current=$(settings get secure enabled_notification_listeners 2>/dev/null)

    # 检查 ExoMind 是否在列表中
    if [[ -z "$current" ]] || [[ ! "$current" == *"$EXOMIND_PKG"* ]]; then
        log "⚠️ 检测到权限丢失，尝试恢复..."

        if [[ -z "$current" ]]; then
            new_list="$EXOMIND_SERVICE"
        else
            new_list="$current:$EXOMIND_SERVICE"
        fi

        settings put secure enabled_notification_listeners "$new_list"
        log "✅ 权限已恢复: $new_list"
    else
        log "✅ 权限正常"
    fi
}

# 监控函数
monitor_permission() {
    while true; do
        current=$(settings get secure enabled_notification_listeners 2>/dev/null)

        if [[ -z "$current" ]] || [[ ! "$current" == *"$EXOMIND_PKG"* ]]; then
            log "⚠️ 权限丢失，恢复中..."
            restore_permission
        fi

        sleep 10  # 每10秒检查一次
    done
}

# 启动
log "=== ExoMind 通知权限守护启动 ==="
restore_permission  # 立即检查一次
monitor_permission &  # 启动后台监控
log "后台监控已启动 (PID: $!)"

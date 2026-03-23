#!/system/bin/sh
# 文件: init.exomind.sh
# 作用: 额外初始化（可选）
# 作者: ExoMind Team

# 确保应用有权限修改设置
pm grant com.exomind.app android.permission.WRITE_SECURE_SETTINGS 2>/dev/null

# 如果有 SELinux 上下文问题，尝试修复
restorecon -r /data/data/com.exomind.app 2>/dev/null

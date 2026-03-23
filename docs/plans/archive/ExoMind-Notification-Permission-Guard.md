# ExoMind 通知权限守护模块

## 概述

本模块用于确保 ExoMind Android 应用始终拥有通知监听权限 (NotificationListenerService)，解决 DND（免打扰）模式下权限丢失的问题。

## 问题背景

### Android 通知监听权限

ExoMind 需要通过 `NotificationListenerService` 监听系统所有通知，但：

1. 用户需要手动在系统设置中授权
2. 部分定制系统（MIUI、EMUI、ColorOS 等）在开启 DND 时会**自动撤销**通知监听权限
3. 导致 ExoMind 收不到任何通知

### 解决方案

通过 Root 权限 + Shell 脚本实现：
- 系统启动时自动恢复权限
- 后台持续监控权限状态
- 权限丢失时自动修复

## 技术方案

### Shell 脚本方案（推荐）

```
┌─────────────────────────────────────────────────────────────┐
│              Shell 脚本方案工作流程                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  post-fs-data.sh (系统启动时执行)                            │
│       ↓                                                     │
│  1. 读取当前权限列表                                         │
│     settings get secure enabled_notification_listeners      │
│       ↓                                                     │
│  2. 检查 ExoMind 是否在列表中                                │
│       ↓                                                     │
│  3. 如果不在，追加到列表                                     │
│     settings put secure enabled_notification_listeners      │
│       ↓                                                     │
│  4. 启动后台监控线程（每 10 秒检查）                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 权限存储机制

通知监听权限存储在系统设置中：

```bash
# 获取当前权限列表
settings get secure enabled_notification_listeners

# 设置权限列表
settings put secure enabled_notification_listeners "包名/服务类名"
```

格式：
```
com.exomind.app/com.exomind.app.service.ExoMindNLS:其他应用/其他服务
```

## 使用方法

### 1. 准备 Root 环境

确保设备已安装以下任一 Root 方案：
- **KernelSU** (推荐)
- **KernelSU-Next**
- **Magisk**
- **APatch**

### 2. 安装模块

#### 方式一：通过 KernelSU 管理器安装

1. 打开 KernelSU 管理器
2. 点击「模块」→「从本地安装」
3. 选择 `ExoMind-NLS-Guardian-v1.0.0.zip`
4. 重启系统

#### 方式二：手动刷入

```bash
# 如果 KernelSU 支持 LKM（可加载内核模块）
adb push ExoMind-NLS-Guardian.zip /sdcard/
# 在 KernelSU 管理器中安装

# 或通过 recovery 刷入
# 1. 进入 TWRP/recovery
# 2. 安装 → 选择 ZIP 文件
# 3. 重启
```

### 3. 验证安装

```bash
# 检查日志
adb shell
cat /data/adb/modules/exomind-nls-guardian/exomind_nls_guardian.log

# 检查权限状态
adb shell settings get secure enabled_notification_listeners
```

输出应包含：`com.exomind.app`

### 4. 测试权限恢复

1. 进入「设置」→「通知」→「通知使用权」
2. 取消 ExoMind 的权限
3. 等待 10 秒
4. 重新检查，权限应已自动恢复

## 模块文件结构

```
ExoMind-NLS-Guardian/
├── module.prop                    # 模块元数据
├── post-fs-data.sh               # 启动脚本（核心逻辑）
├── system/
│   └── etc/
│       └── init.exomind.sh       # 初始化脚本（可选）
└── META-INF/
    └── com/
        └── google/
            └── android/
                └── update-binary # 更新二进制（可选）
```

### module.prop

```properties
id=exomind-nls-guardian
name=ExoMind 通知权限守护
version=v1.0.0
versionCode=1
author=ExoMind Team
description=确保 ExoMind 始终拥有通知监听权限，绕过 DND 权限丢失问题
minSdkVersion=26
```

### post-fs-data.sh（核心）

```bash
#!/system/bin/sh
# 文件: post-fs-data.sh
# 作用: 系统启动时自动恢复通知权限，并持续监控

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
        log "✅ 权限正常: $current"
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
```

## 高级配置

### 排除特定应用

如果某些应用不应被监控，可以在脚本中添加过滤：

```bash
# 在 monitor_permission 函数中添加
if [[ "$current" == *"银行应用包名"* ]]; then
    log "跳过排除列表中的应用"
    continue
fi
```

### 调整检查间隔

修改 `sleep 10` 中的数值：

```bash
sleep 5   # 更频繁检查（5秒）
sleep 30  # 更少频繁检查（30秒）
```

### 启用详细日志

```bash
# 在 log 函数中添加更多调试信息
log "当前权限列表: $current"
log "检查结果: $is_valid"
```

## 故障排除

### 模块未生效

**检查清单：**
- [ ] Root 权限是否正常
- [ ] 模块是否正确安装
- [ ] 系统是否已重启

**排查命令：**
```bash
# 检查模块是否存在
ls -la /data/adb/modules/exomind-nls-guardian/

# 检查日志
cat /data/adb/modules/exomind-nls-guardian/exomind_nls_guardian.log

# 手动执行脚本测试
sh /data/adb/modules/exomind-nls-guardian/post-fs-data.sh
```

### 权限无法恢复

**原因：** 部分系统可能有额外的权限保护

**解决方案：**
```bash
# 尝试使用更高权限
su -c "settings put secure enabled_notification_listeners $new_list"

# 或使用 pm grant
pm grant com.exomind.app android.permission.WRITE_SECURE_SETTINGS
```

### 日志显示权限正常但实际无效

**原因：** 可能是系统缓存问题

**解决方案：**
```bash
# 强制刷新设置
settings put secure enabled_notification_listeners ""
settings put secure enabled_notification_listeners "$EXOMIND_SERVICE"

# 重启系统服务
killall system_server
```

## 原理详解

### Android 通知权限机制

1. **权限存储位置**
   ```
   Settings.Secure.enabled_notification_listeners
   ```

2. **权限检查流程**
   ```
   应用发送通知
        ↓
   NotificationManagerService.checkNotificationListener()
        ↓
   检查 enabled_notification_listeners 是否包含应用
        ↓
   允许/拒绝监听
   ```

3. **DND 影响**
   - 部分系统会在开启 DND 时清空 enabled_notification_listeners
   - 这是系统行为，不是 bug

### Shell 脚本原理

1. **post-fs-data.sh**
   - 系统启动时（late_start service mode）执行
   - 此时 Settings 数据库已就绪
   - 可以读写 secure 表

2. **settings 命令**
   - Android 内置的设置管理工具
   - 需要 Root 权限才能修改 secure 表

3. **后台监控**
   - 使用 `&` 将监控函数放入后台
   - 使用 `while true + sleep` 实现循环
   - 使用 `PID` 记录进程以便管理

## 替代方案

### ZygiskNext 方案（可选）

如果需要更底层的权限绕过，可以使用 ZygiskNext + C++ Hook：

**优点：**
- 在系统层面绕过权限检查
- 不需要修改 Settings 数据库

**缺点：**
- 需要安装 ZygiskNext
- 开发复杂度高
- 兼容性可能有问题

**项目状态：**
- ZygiskNext 最后更新：2025年11月
- 仍在活跃维护中
- GitHub: https://github.com/Dr-TSNG/ZygiskNext

**注意：** Shell 脚本方案已足够可靠，不推荐使用 ZygiskNext 方案。

## 兼容性

| 系统版本 | 兼容性 | 备注 |
|---------|--------|------|
| Android 8.0 (API 26) | ✅ | 最低支持版本 |
| Android 9.0 | ✅ | |
| Android 10 | ✅ | |
| Android 11 | ✅ | |
| Android 12 | ✅ | |
| Android 13 | ✅ | |
| Android 14 | ✅ | |
| Android 15 | ✅ | |

| 设备品牌 | 兼容性 | 备注 |
|---------|--------|------|
| Pixel/Nexus | ✅ | 原生系统 |
| 小米 (MIUI) | ✅ | 需要测试 DND 场景 |
| 华为 (EMUI/HarmonyOS) | ✅ | 需要测试 DND 场景 |
| OPPO (ColorOS) | ✅ | 需要测试 DND 场景 |
| vivo (FuntouchOS) | ✅ | 需要测试 DND 场景 |
| 一加 (OxygenOS) | ✅ | |
| 三星 (OneUI) | ✅ | |

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0.0 | 2025-02-03 | 初始版本 |

## 常见问题 (FAQ)

**Q: 需要每次重启后手动操作吗？**
A: 不需要，模块会自动执行。

**Q: 会影响系统性能吗？**
A: 几乎不影响。后台监控每 10 秒执行一次，每次只有几条命令。

**Q: 能防止所有权限丢失吗？**
A: 能防止大多数情况。极少数系统可能有更复杂的保护机制。

**Q: 如何卸载模块？**
A: 通过 KernelSU 管理器卸载，然后重启系统。

**Q: 能用于其他应用吗？**
A: 可以，只需修改脚本中的 `EXOMIND_PKG` 和 `EXOMIND_SERVICE`。

## 参考资料

- [KernelSU 官方文档](https://kernelsu.com/)
- [Android Settings Provider](https://developer.android.com/reference/android/provider/Settings.Secure)
- [NotificationListenerService](https://developer.android.com/reference/android/service/notification/NotificationListenerService)

## License

MIT

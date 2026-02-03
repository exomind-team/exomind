# ExoMind 通知权限守护模块

## 快速安装

### 方法一：通过 KernelSU 管理器安装

1. 打开 KernelSU 管理器
2. 点击「模块」→「从本地安装」
3. 选择 `ExoMind-NLS-Guardian-v1.0.0.zip`
4. 重启系统

### 方法二：手动刷入

```bash
# 1. 将 ZIP 文件传到手机
adb push ExoMind-NLS-Guardian-v1.0.0.zip /sdcard/Download/

# 2. 在 KernelSU 管理器中安装
# 或通过 TWRP recovery 刷入
```

## 验证安装

```bash
# 检查模块是否激活
adb shell
ls /data/adb/modules/exomind-nls-guardian/

# 查看日志
cat /data/adb/modules/exomind-nls-guardian/exomind_nls_guardian.log
```

## 文件说明

```
ExoMind-NLS-Guardian/
├── module.prop              # 模块配置
├── post-fs-data.sh          # 核心脚本：恢复权限 + 后台监控
└── system/
    └── etc/
        └── init.exomind.sh  # 额外初始化（可选）
```

## 打包命令

```bash
cd modules/ExoMind-NLS-Guardian

# 方法1：使用 zip（推荐）
zip -r ExoMind-NLS-Guardian-v1.0.0.zip *

# 方法2：使用 PowerShell（Windows）
Compress-Archive -Path * -DestinationPath ExoMind-NLS-Guardian-v1.0.0.zip -Force
```

## 更多信息

详细文档：[../../DOCS/ExoMind-Notification-Permission-Guard.md](../../DOCS/ExoMind-Notification-Permission-Guard.md)

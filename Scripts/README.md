# ExoMind 脚本系统

ExoMind 的 PowerShell 自动化脚本集合，支持桌面端和 Android 端的一键构建、开发和测试。

## 快速开始

```powershell
# 全平台构建
cd Scripts\build
.\all.ps1

# 桌面端开发
cd Scripts\dev
.\desktop.ps1

# 显示全部开发启动命令
cd Scripts\dev
.\all.ps1

# 运行测试
cd Scripts\test
.\all.ps1
```

## 目录结构

```
Scripts/
├── README.md              # 本文件
├── CLAUDE.md              # 大模型使用指南
│
├── build/                 # 构建脚本
│   ├── all.ps1           # 全平台构建（桌面+Android）
│   ├── desktop.ps1       # 桌面端构建（Windows）
│   └── android.ps1       # Android 端构建
│
├── dev/                   # 开发启动脚本
│   ├── all.ps1           # 显示全部开发启动命令
│   ├── desktop.ps1       # 桌面端开发模式
│   └── android.ps1       # Android 端开发模式
│
├── test/                  # 测试脚本
│   ├── all.ps1           # 全部测试
│   ├── unit.ps1          # 单元测试（Vitest）
│   └── integration.ps1   # 集成测试
│
└── _shared/               # 共享配置
    └── config.ps1        # 环境配置和工具函数
```

## 环境要求

- **Windows** + PowerShell 5.1+
- **Bun** 包管理器
- **Rust** 工具链
- **Java 17**（Android 构建需要）
- **Android SDK** + **NDK**（Android 构建需要）

### 项目路径配置

脚本已预配置以下路径（在 `Scripts/_shared/config.ps1` 中修改）：

```powershell
Java 17:    D:\data\AndroidStudioSDK\java17
Android SDK: D:\data\AndroidStudioSDK
```

## 构建脚本

### build/all.ps1 - 全平台构建

```powershell
# 构建全部平台
.\build\all.ps1

# 只构建 Android（跳过桌面端）
.\build\all.ps1 -SkipDesktop

# 只构建桌面端（跳过 Android）
.\build\all.ps1 -SkipAndroid

# 构建 Android 并自动安装
.\build\all.ps1 -InstallAndroid
```

### build/desktop.ps1 - 桌面端构建

```powershell
# 标准构建
.\build\desktop.ps1

# 深度清理后构建
.\build\desktop.ps1 -Clean
```

**输出文件**:
- `src-tauri\target\release\bundle\msi\*.msi`
- `src-tauri\target\release\bundle\nsis\*-setup.exe`

### build/android.ps1 - Android 端构建

```powershell
# 标准构建
.\build\android.ps1

# 构建并安装
.\build\android.ps1 -Install

# 构建发布版
.\build\android.ps1 -Release

# 指定设备安装
.\build\android.ps1 -Install -Device emulator-5554
```

**输出文件**:
- `src-tauri\gen\android\app\build\outputs\apk\debug\app-universal-debug.apk`

## 开发脚本

### Windows vs Android 开发差异

| 特性 | Windows 桌面端 | Android 端 |
|------|---------------|-----------|
| 设备要求 | 本地运行，无需设备 | 需连接设备或模拟器 |
| 热重载 | 前端代码自动热重载 | 支持热重载和 HMR |
| Rust 修改 | 需要重启 | 需要重新构建 |
| 设备断开 | 不影响 | 需重新运行 |

### dev/desktop.ps1 - 桌面端开发

```powershell
# 启动开发服务器
.\dev\desktop.ps1

# 跳过依赖安装
.\dev\desktop.ps1 -NoInstall
```

### dev/tauri-dev-manager.ts - 多实例桌面开发管理器

推荐用这个入口管理多个 `tauri dev` 实例，而不是手工 `taskkill /T`：

```powershell
# 启动一个受管实例（自动分配端口并登记 PID / 日志）
bun run tauri:manager -- start --name codex-main

# 查看当前受管实例
bun run tauri:manager -- list

# 实时跟随日志
bun run tauri:manager -- logs --name codex-main --follow

# 精确停止某一个实例
bun run tauri:manager -- stop --name codex-main
```

说明：

- 实例元数据保存在 `.tmp\tauri-dev-instances\*.json`
- 日志保存在 `.tmp\tauri-dev-instances\*.log`
- `stop` 只会终止该实例登记的根进程树，避免误杀其它 `tauri dev`

### dev/android.ps1 - Android 端开发

```powershell
# 启动开发服务器（自动构建安装 APK）
.\dev\android.ps1

# 纯开发模式（不自动安装 APK）
.\dev\android.ps1 -NoInstallApk

# 跳过依赖安装
.\dev\android.ps1 -NoInstall
```

### dev/all.ps1 - 显示全部命令

```powershell
# 显示所有开发启动命令
.\dev\all.ps1
```

## 测试脚本

### test/all.ps1 - 全部测试

```powershell
# 运行全部测试
.\test\all.ps1

# 只运行单元测试
.\test\all.ps1 -SkipIntegration

# 只运行集成测试
.\test\all.ps1 -SkipUnit
```

### test/unit.ps1 - 单元测试

```powershell
# 运行单元测试
.\test\unit.ps1

# 监视模式
.\test\unit.ps1 -Watch

# 生成覆盖率报告
.\test\unit.ps1 -Coverage
```

### test/integration.ps1 - 集成测试

```powershell
# 运行集成测试
.\test\integration.ps1

# 详细输出
.\test\integration.ps1 -Verbose
```

## 执行策略设置

首次运行 PowerShell 脚本可能需要设置执行策略：

```powershell
# 以管理员身份运行 PowerShell，执行：
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 或在每次运行时临时绕过：
powershell -ExecutionPolicy Bypass -File Scripts\build\all.ps1
```

## 设备连接

### 检查设备

```powershell
# 查看连接的设备
adb devices

# 输出示例：
# List of devices attached
# emulator-5554    device
# 8GH0220820003069 device
```

### 多设备处理

当连接多个设备时，脚本会：
1. 默认选择第一个设备
2. 或通过 `-Device` 参数指定

```powershell
# 指定特定设备
.\build\android.ps1 -Install -Device emulator-5554
```

## 构建日志

所有构建脚本自动保存构建日志到 `build-logs/` 目录：

```
build-logs/
├── android-build-20250203-101532.log
├── desktop-build-20250203-102145.log
└── ...
```

日志内容包括：
- 构建日期时间
- 各阶段耗时
- 输出文件路径和大小
- 设备信息

## 常见问题

### Q: 找不到 Java 17

**A**: 修改 `Scripts/_shared/config.ps1` 中的路径：
```powershell
$Global:EMConfig = @{
    Java17 = "你的Java17路径"
    ...
}
```

### Q: 找不到 ADB

**A**: 修改 `Scripts/_shared/config.ps1` 中的路径：
```powershell
$Global:EMConfig = @{
    AndroidSdk = "你的Android SDK路径"
    ...
}
```

### Q: Android 构建失败

**A**: 检查以下几点：
1. `src-tauri/gen/android` 是否存在（未初始化则运行 `bun run tauri android init`）
2. `ANDROID_HOME` 环境变量是否设置
3. NDK 是否正确安装

### Q: 安装失败（证书错误）

**A**: 发布版 APK 需要签名，使用 Debug 版或添加签名步骤：
```powershell
# 使用 Debug 版（自动签名）
.\build\android.ps1 -Install

# 或发布版（自动创建密钥签名）
.\build\android.ps1 -Install -Release
```

## 完整工作流示例

```powershell
# 1. 开发阶段 - 启动开发服务器
.\dev\desktop.ps1

# 2. 测试阶段 - 构建并安装
.\build\android.ps1 -Install

# 3. 发布阶段 - 构建所有平台
.\build\all.ps1

# 4. 查看构建日志
cat build-logs\*.log
```

## 技术支持

- [Tauri 官方文档](https://tauri.app/)
- [Tauri Android 指南](https://tauri.app/v2/guides/mobile/android/)
- [Android Studio 下载](https://developer.android.com/studio)

## GitHub 评论脚本（Bun + TypeScript）

用于新增、追加、覆盖 Issue/PR 评论，使用 Bun 直接运行 TypeScript，减少 PowerShell 对 Markdown 参数的转义干扰。

```powershell
# 新增评论
bun run gh:comment -- --type issue --number 93 --file docs/report.md

# 追加到指定评论（注意 # 前缀需要加引号）
bun run gh:comment -- --type issue --number 93 --comment "#issuecomment-3883010944" --mode append --file docs/add.md

# 覆盖指定评论
bun run gh:comment -- --type issue --number 93 --comment "#issuecomment-3883010944" --mode replace --file docs/final.md

# 用完整链接自动解析 repo/type/number/comment
bun run gh:comment -- --ref "https://github.com/exomind-team/exomind/issues/93#issuecomment-3883010944" --file docs/add.md --mode append

# 只看解析结果，不写入 GitHub
bun run gh:comment -- --ref "https://github.com/exomind-team/exomind/pull/89" --body "test" --dry-run

# PowerShell 直接调用
.\Scripts\dev\github-comment.ps1 --ref "https://github.com/exomind-team/exomind/issues/93#issuecomment-3883010944" --file docs/add.md --mode append
```

参数说明：

- `--type issue|pr`：目标类型。
- `--number`：Issue/PR 编号。
- `--comment`：评论定位，支持 `#issuecomment-xxxx`、URL、纯数字 id。
- `--mode create|append|replace`：操作模式。默认：无 comment 为 `create`，有 comment 为 `append`。
- `--file` / `--body`：Markdown 输入来源（二选一）。
- `--ref`：完整 GitHub 链接（可含 `#issuecomment-...`）。
- `--repo`：仓库 `owner/name`（省略时自动探测）。


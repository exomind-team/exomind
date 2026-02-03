# 快速参考卡片

## 🚀 改造现有项目（3步搞定）

```powershell
# 第1步：复制脚本
copy tauri-app\build-android-auto.ps1 你的项目\
copy tauri-app\build-desktop-v2.ps1   你的项目\

# 第2步：修改路径
# 编辑 build-android-auto.ps1，改成你的路径：
$Config.Java17 = "D:\你的\Java17\路径"
$Config.AndroidSdk = "D:\你的\AndroidSDK\路径"

# 第3步：运行测试
cd 你的项目
.\build-android-auto.ps1
```

---

## 🆕 创建新项目（5步搞定）

```powershell
# 第1步：复制模板
xcopy /E /I tauri-app my-new-project
cd my-new-project

# 第2步：清理
Remove-Item -Recurse -Force .git, src-tauri/target, node_modules

# 第3步：改名（批量替换）
# package.json:          "name": "my-new-project"
# tauri.conf.json:       "productName": "My New Project"
# tauri.conf.json:       "identifier": "com.you.app"
# Cargo.toml:            name = "my_new_project"

# 第4步：安装
bun install

# 第5步：启动
.\dev.ps1 desktop
```

---

## 📋 路径检查清单

改造任何项目前，确认：

| 检查项 | 你的路径 | 状态 |
|--------|---------|------|
| Java 17 | `D:\data\AndroidStudioSDK\java17` | ☐ |
| Android SDK | `D:\data\AndroidStudioSDK` | ☐ |
| Bun | `C:\Users\你\.bun\bin` | ☐ |
| Rust | `C:\Users\你\.cargo\bin` | ☐ |

---

## 🔧 一键验证脚本

创建 `check.ps1`：

```powershell
Write-Host "检查环境..." -ForegroundColor Cyan
try { bun --version; Write-Host "Bun OK" -ForegroundColor Green } catch { Write-Host "Bun 缺失" -ForegroundColor Red }
try { rustc --version; Write-Host "Rust OK" -ForegroundColor Green } catch { Write-Host "Rust 缺失" -ForegroundColor Red }
try { java -version 2>&1 | Select-String "version"; Write-Host "Java OK" -ForegroundColor Green } catch { Write-Host "Java 缺失" -ForegroundColor Red }
if (Test-Path "src-tauri") { Write-Host "项目结构 OK" -ForegroundColor Green } else { Write-Host "缺少 src-tauri" -ForegroundColor Red }
```

---

## 💡 常见问题速查

| 问题 | 解决 |
|------|------|
| 找不到 Java | 修改脚本里的 `Java17` 路径 |
| 找不到 ADB | 修改脚本里的 `AndroidSdk` 路径 |
| Android 未初始化 | 运行 `bun run tauri android init` |
| APK 安装失败 | 用 Debug 模式（不加 `-Release`）|
| 多设备安装错误 | 加 `-Device emulator-5554` |

---

## 📁 核心文件清单

改造任何项目，**必须**有：

```
必需文件：
├── src-tauri/
│   ├── src/lib.rs          # Rust 代码
│   ├── tauri.conf.json     # Tauri 配置 ⭐
│   └── Cargo.toml          # Rust 配置
├── vite.config.ts          # Vite 配置 ⭐
├── package.json            # Node 配置 ⭐
└── build-android-auto.ps1  # 自动化脚本 ⭐

可选文件：
├── build-desktop-v2.ps1    # 桌面端构建
├── build-all-v2.ps1        # 全平台构建
└── dev.ps1                 # 开发启动
```

---

## 🎯 最小改动原则

只想用 Android 自动构建？**只做这3件事**：

1. 复制 `build-android-auto.ps1`
2. 改脚本里的 Java 路径
3. 改脚本里的 SDK 路径

其他什么都不用动！

---

## 📞 求助命令

遇到问题时运行：

```powershell
# 查看完整错误
$ErrorActionPreference = "Continue"
.\build-android-auto.ps1 -Verbose

# 检查环境变量
Get-ChildItem Env: | Where-Object { $_.Name -match "JAVA|ANDROID" }

# 验证 ADB 连接
adb devices -l
```

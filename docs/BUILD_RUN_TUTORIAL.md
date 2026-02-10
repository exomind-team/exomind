# ExoMind 构建运行教程

> ExoMind - 个人/集体的生命成长助手

## 目录

- [环境要求](#环境要求)
- [安装依赖](#安装依赖)
- [开发模式运行](#开发模式运行)
- [构建生产版本](#构建生产版本)
- [常见问题](#常见问题)

---

## 环境要求

| 工具 | 版本 | 说明 |
|------|------|------|
| [Bun](https://bun.sh/) | 最新版 | JavaScript 包管理器 |
| [Rust](https://www.rust-lang.org/tools/install) | 2021 Edition | 后端编译 |
| [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) | 2022+ | Windows 编译依赖 |

### Windows 额外要求

安装 Visual Studio Build Tools 时，选择以下组件：
- "C++ 构建工具"
- "Windows 11 SDK" (或 Windows 10 SDK)

### Android 开发额外要求

| 工具 | 版本 | 说明 |
|------|------|------|
| [Android Studio](https://developer.android.com/studio) | 2023.0+ | Android 开发 IDE |
| JDK | 17 | Android 构建要求 |

---

## 安装依赖

### 1. 安装 Bun（如果尚未安装）

```powershell
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -c "(new-object net.webclient).DownloadString('https://bun.sh/install.ps1') | iex"
```

### 2. 验证安装

```bash
# 检查 Bun 版本
bun --version

# 检查 Rust 版本
rustc --version
cargo --version
```

### 3. 安装项目依赖

```bash
# 安装前端依赖
bun install

# 安装 Tauri CLI（全局）
bun add @tauri-apps/cli --global
```

**预期输出：**
```
√ bun install
√ Installed [x] packages
```

---

## 开发模式运行

### 桌面端开发

#### 方式一：使用 dev.ps1 脚本（推荐）

```powershell
# PowerShell
.\dev.ps1
```

此脚本会自动：
1. 启动 Vite 开发服务器（前端热重载）
2. 启动 Tauri 开发窗口

#### 方式二：直接运行

```bash
# 仅前端（Web 预览）
bun run dev

# 桌面应用
bun run tauri dev
```

**预期输出：**
```
  VITE v6.0.3  ready in 300 ms

  ➜  Local:   http://localhost:1420/
  ➜  Network: http://192.168.x.x:1420/

  [tauri] Tauri application started...
```

### Android 开发

```bash
# 首次初始化（仅需一次）
bun run tauri android init

# 启动 Android 开发
bun run tauri android dev
```

**要求：**
- Android Studio 已安装
- JDK 17 已配置
- 设备/模拟器已连接

---

## 构建生产版本

### 桌面端构建

#### Windows MSI 安装包

```powershell
bun run tauri build --bundles msi
```

**输出位置：**
```
src-tauri/target/release/bundle/msi/exomind_0.1.0_x64_en-US.msi
```

#### Windows NSIS 安装包

```powershell
bun run tauri build --bundles nsis
```

**输出位置：**
```
src-tauri/target/release/bundle/nsis/exomind_0.1.0_x64-setup.exe
```

### Android 构建

```bash
# Debug 版本
bun run tauri android build

# 输出位置：src-tauri/gen/android/app/build/outputs/apk/debug/app-debug.apk
```

### 使用自动化脚本

| 脚本 | 功能 |
|------|------|
| `build-desktop-v2.ps1` | 桌面端构建 + 计时统计 |
| `build-android-auto.ps1` | Android 全自动构建 + 安装 |
| `build-all-v2.ps1` | 一键构建所有平台 |

```powershell
# 桌面端构建
.\build-desktop-v2.ps1

# Android 构建并安装到设备
.\build-android-auto.ps1
```

### 纯前端构建

```bash
# 构建前端（不包含 Tauri）
bun run build

# 输出目录：dist/
```

---

## 测试

### 单元测试

```bash
# 运行所有测试
bun test

# 运行同步模块测试
bun run test:sync
```

### E2E 测试

```bash
# 运行 E2E 测试
bun run test:e2e

# 生成 HTML 报告
bun run test:e2e:report
```

---

## 常见问题

### Q1: `bun: command not found`

**问题：** 无法识别 bun 命令

**解决方案：**
```powershell
# 重新打开终端或执行
$env:PATH += ";$env:USERPROFILE\.bun\bin"
```

或者确保 Bun 已添加到系统 PATH。

---

### Q2: Windows 构建时提示缺少 C++ 编译器

**问题：** `error: no suitable C++ compiler found`

**解决方案：**

1. 安装 [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/downloads/)
2. 安装时选择 "C++ 构建工具" 工作负载

或者运行：
```powershell
winget install Microsoft.VisualStudio.2022.BuildTools
winget install Microsoft.VisualStudio.2022.BuildTools.C++.
```

---

### Q3: Tauri 初始化失败

**问题：** `tauri android init` 失败

**解决方案：**

1. 检查 Java 版本：
   ```bash
   java -version
   ```
   确保是 JDK 17。

2. 设置 JAVA_HOME：
   ```powershell
   $env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-17.0.10.7\"
   ```

3. 检查 Android SDK：
   ```powershell
   $env:ANDROID_HOME = "C:\Users\<用户名>\AppData\Local\Android\Sdk"
   ```

---

### Q4: Android 设备连接失败

**问题：** `adb devices` 找不到设备

**解决方案：**

1. 启用设备开发者选项中的 "USB 调试"
2. 信任计算机
3. 检查 ADB：
   ```bash
   adb devices
   ```

---

### Q5: 端口被占用

**问题：** `EADDRINUSE: address already in use :::1420`

**解决方案：**

1. 查找占用端口的进程：
   ```bash
   # Windows
   netstat -ano | findstr :1420
   ```

2. 终止进程：
   ```powershell
   # 替换 <PID> 为进程 ID
   taskkill /PID <PID> /F
   ```

3. 或修改端口（在 `vite.config.ts` 中配置）

---

### Q6: 依赖安装失败

**问题：** `bun install` 失败

**解决方案：**

1. 清除缓存重试：
   ```bash
   bun clean
   bun install
   ```

2. 删除 node_modules 重新安装：
   ```bash
   rm -rf node_modules package-lock.json bun.lockb
   bun install
   ```

---

### Q7: Rust 工具链问题

**问题：** `error: toolchain 'stable-msvc' not found`

**解决方案：**

```bash
# 添加 MSVC 工具链
rustup toolchain install stable-msvc

# 设置为默认
rustup default stable-msvc
```

---

### Q8: 签名/权限错误

**问题：** Android 构建时提示签名或权限错误

**解决方案：**

1. 在 `build-android-auto.ps1` 中配置正确的 SDK 路径：
   ```powershell
   $Config = @{
       Java17 = "C:\Program Files\Microsoft\jdk-17.0.10.7"
       AndroidSdk = "C:\Users\<用户名>\AppData\Local\Android\Sdk"
   }
   ```

2. 确保 NDK 已通过 Android Studio SDK Manager 安装。

---

## 环境变量配置

### 必需的环境变量

| 变量 | 说明 | Windows 示例 |
|------|------|-------------|
| `JAVA_HOME` | JDK 17 路径 | `C:\Program Files\Microsoft\jdk-17.0.10.7` |
| `ANDROID_HOME` | Android SDK 路径 | `C:\Users\xxx\AppData\Local\Android\Sdk` |
| `ANDROID_SDK_ROOT` | Android SDK 根目录 | 同上 |

### 可选的环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `TAURI_DEV_PORT` | 开发模式端口 | `1420` |
| `TAURI_SENTRY_DSN` | Sentry 监控 | - |

### 临时设置（PowerShell）

```powershell
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-17.0.10.7"
$env:ANDROID_HOME = "C:\Users\用户名\AppData\Local\Android\Sdk"
```

---

## 项目结构速览

```
exomind/
├── src/                      # 前端源代码
│   ├── App.tsx              # 主应用组件
│   ├── main.tsx              # React 入口
│   ├── components/           # React 组件
│   └── lib/                  # 工具库
├── src-tauri/               # Tauri 后端代码
│   ├── src/
│   │   ├── lib.rs          # Rust 核心库
│   │   ├── main.rs         # 程序入口
│   │   └── commands/       # Tauri 命令
│   ├── Cargo.toml          # Rust 配置
│   └── tauri.conf.json    # Tauri 配置
├── dist/                    # 构建输出
├── package.json             # 前端依赖配置
└── vite.config.ts           # Vite 配置
```

---

## 相关文档

| 文档 | 链接 |
|------|------|
| README | [README.md](README.md) |
| API 文档 | [docs/API.md](docs/API.md) |
| 架构设计 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 开发规范 | [CLAUDE.md](CLAUDE.md) |

# 脚本迁移指南

将 `build-android-auto.ps1` 等自动化脚本应用到你的新/旧 Tauri 项目。

---

## 方案一：改造现有 Tauri 项目（推荐）

适用于：已有 Tauri 项目，想添加自动化构建功能

### 步骤 1：复制脚本文件

将以下文件从模板复制到你的项目根目录：

```
build-android-auto.ps1      ← 核心脚本
build-desktop-v2.ps1        ← 桌面端构建
build-all-v2.ps1           ← 全平台构建
dev.ps1                    ← 开发启动（可选）
README-Scripts.md          ← 文档（可选）
```

### 步骤 2：检查/修改 vite.config.ts

确保 Vite 配置支持 Tauri：

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Tauri 专用配置
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
```

### 步骤 3：检查 src-tauri/tauri.conf.json

关键字段必须存在：

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "你的应用名",
  "version": "0.1.0",
  "identifier": "com.yourcompany.appname",
  "build": {
    "beforeDevCommand": "bun run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "bun run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "你的应用名",
        "width": 800,
        "height": 600
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

### 步骤 4：修改脚本中的路径（重要）

打开 `build-android-auto.ps1`，检查/修改：

```powershell
$Config = @{
    Java17 = "D:\data\AndroidStudioSDK\java17"      # ← 改成你的 Java 17 路径
    AndroidSdk = "D:\data\AndroidStudioSDK"        # ← 改成你的 Android SDK 路径
}
```

### 步骤 5：检查 package.json 脚本

确保有以下脚本：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "tauri": "tauri"
  }
}
```

### 步骤 6：初始化 Android（如需 Android 支持）

```bash
# 如果还没有 Android 支持
bun run tauri android init
```

### 步骤 7：测试构建

```powershell
# 桌面端测试
.\build-desktop-v2.ps1

# Android 测试
.\build-android-auto.ps1
```

---

## 方案二：从零创建全新项目

### 方法 A：基于本模板复制（最快）

```powershell
# 1. 复制模板项目
xcopy /E /I tauri-app my-new-project
cd my-new-project

# 2. 清理不需要的文件
Remove-Item -Recurse -Force .git
Remove-Item -Recurse -Force src-tauri/target
Remove-Item -Recurse -Force src-tauri/gen/android
Remove-Item -Recurse -Force node_modules
Remove-Item -Recurse -Force dist
Remove-Item -Recurse -Force build-logs

# 3. 修改项目名（以下文件）
```

需要修改的文件清单：

| 文件 | 修改内容 | 示例 |
|------|---------|------|
| `package.json` | `"name"` | `"my-new-app"` |
| `package.json` | `"version"` | `"1.0.0"` |
| `src-tauri/tauri.conf.json` | `productName` | `"My New App"` |
| `src-tauri/tauri.conf.json` | `identifier` | `"com.mycompany.mynewapp"` |
| `src-tauri/tauri.conf.json` | `windows[0].title` | `"My New App"` |
| `src-tauri/Cargo.toml` | `name` | `my_new_app` |
| `src-tauri/Cargo.toml` | `description` | `"My new Tauri app"` |
| `index.html` | `<title>` | `My New App` |
| `src/App.tsx` | 标题文字 | 改成你的应用名 |

```powershell
# 4. 安装依赖
bun install

# 5. 初始化 Android（可选）
bun run tauri android init

# 6. 启动开发
.\dev.ps1 desktop
```

### 方法 B：使用官方 CLI + 脚本移植

```bash
# 1. 官方方式创建项目
bun create tauri-app@latest my-new-project
# 选择：React + TypeScript + Bun

cd my-new-project

# 2. 从模板复制脚本
copy ..\tauri-app\build-android-auto.ps1 .
copy ..\tauri-app\build-desktop-v2.ps1 .
copy ..\tauri-app\dev.ps1 .

# 3. 修改 vite.config.ts（添加 Tauri 端口配置）
# 参见方案一的步骤 2

# 4. 完成
```

---

## 方案三：给非 Tauri 项目添加 Tauri（进阶）

适用于：已有 React/Vue 项目，想打包成桌面/Android 应用

### 步骤 1：确认前端项目结构

你的项目应该有：
- `package.json` 有 `build` 脚本
- 构建输出到 `dist/` 目录

### 步骤 2：添加 Tauri

```bash
# 安装 Tauri CLI
cargo install tauri-cli

# 初始化 Tauri
bunx tauri init
```

初始化时回答：
- App name: 你的应用名
- Window title: 窗口标题
- Web assets: `../dist`（相对 src-tauri 目录）
- Dev server URL: `http://localhost:5173` 或你的端口

### 步骤 3：复制脚本

同方案一的步骤 1。

### 步骤 4：修改 tauri.conf.json

```json
{
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  }
}
```

---

## 迁移检查清单

改造完成后，逐项检查：

### 基础检查
- [ ] 复制了 `build-android-auto.ps1`
- [ ] 修改了脚本中的 Java17 路径
- [ ] 修改了脚本中的 AndroidSdk 路径
- [ ] `vite.config.ts` 有 Tauri 端口配置
- [ ] `package.json` 有 `dev`、`build`、`tauri` 脚本

### 配置文件检查
- [ ] `tauri.conf.json` 有正确的 `productName`
- [ ] `tauri.conf.json` 有正确的 `identifier`
- [ ] `tauri.conf.json` 的 `frontendDist` 指向正确

### 功能测试
- [ ] `bun install` 成功
- [ ] `bun run dev` 能启动前端
- [ ] `.\dev.ps1 desktop` 能启动桌面端
- [ ] `.\build-desktop-v2.ps1` 能构建桌面端
- [ ] `.\build-android-auto.ps1` 能构建并安装（如有 Android）

---

## 常见问题

### Q1: 脚本运行时提示找不到 bun

**解决**: 确保 Bun 在系统 PATH 中，或在脚本开头添加：
```powershell
$env:PATH = "C:\Users\你的用户名\.bun\bin;$env:PATH"
```

### Q2: Android 构建提示 "未初始化"

**解决**:
```bash
bun run tauri android init
```

### Q3: 桌面端构建成功但 Android 失败

**检查**:
- Java 17 路径是否正确
- Android SDK 路径是否正确
- `ANDROID_HOME` 环境变量是否设置

### Q4: 安装失败 "证书错误"

**解决**: 使用 Debug 构建（默认），或添加 `-Release` 参数：
```powershell
.\build-android-auto.ps1        # Debug 版（自动签名）
.\build-android-auto.ps1 -Release  # Release 版（自动创建密钥）
```

### Q5: 多设备时安装到错误设备

**解决**:
```powershell
# 查看设备列表
adb devices

# 指定设备
.\build-android-auto.ps1 -Device emulator-5554
```

---

## 验证脚本

创建一个验证脚本 `verify-setup.ps1`：

```powershell
Write-Host "验证 Tauri 脚本配置..." -ForegroundColor Cyan

# 检查 bun
try {
    $bun = bun --version
    Write-Host "[OK] Bun: $bun" -ForegroundColor Green
} catch {
    Write-Host "[FAIL] Bun 未找到" -ForegroundColor Red
}

# 检查 Rust
try {
    $rust = rustc --version
    Write-Host "[OK] Rust: $rust" -ForegroundColor Green
} catch {
    Write-Host "[FAIL] Rust 未找到" -ForegroundColor Red
}

# 检查 Java
try {
    $java = java -version 2>&1 | Select-String "version"
    Write-Host "[OK] Java: $java" -ForegroundColor Green
} catch {
    Write-Host "[FAIL] Java 未找到" -ForegroundColor Red
}

# 检查项目结构
if (Test-Path "src-tauri") {
    Write-Host "[OK] src-tauri 存在" -ForegroundColor Green
} else {
    Write-Host "[FAIL] src-tauri 不存在" -ForegroundColor Red
}

# 检查脚本
if (Test-Path "build-android-auto.ps1") {
    Write-Host "[OK] 自动化脚本已复制" -ForegroundColor Green
} else {
    Write-Host "[FAIL] 未找到自动化脚本" -ForegroundColor Red
}

Write-Host "`n验证完成！" -ForegroundColor Cyan
```

运行：
```powershell
.\verify-setup.ps1
```

---

## 最小改造示例

只想用 `build-android-auto.ps1`，其他不动？

**只需做 3 件事**：

1. 复制 `build-android-auto.ps1` 到项目根目录
2. 修改脚本中的 Java17 和 AndroidSdk 路径
3. 确保 `vite.config.ts` 端口是 1420

搞定！其他都可以不改。

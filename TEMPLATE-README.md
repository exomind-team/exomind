# 模板核心资产说明

## 核心资产（复制时保留）

### 1. 自动化脚本（核心价值）
```
build-android-auto.ps1      # ⭐ 最核心 - 全自动 Android 构建+安装
build-desktop-v2.ps1        # 桌面端构建+计时
build-all-v2.ps1           # 一键全平台
dev.ps1                    # 开发启动
```

### 2. 项目配置
```
src-tauri/tauri.conf.json           # Tauri 主配置
src-tauri/capabilities/default.json # 权限配置
vite.config.ts                      # Vite + Tauri 集成配置
package.json                        # 依赖和脚本
tsconfig.json                       # TypeScript 配置
```

### 3. 前后端通信示例
```
src/App.tsx               # 前端调用 Rust 示例
src-tauri/src/lib.rs      # Rust 命令定义
```

## 创建新项目的步骤

### 方法 1: 直接复制修改（推荐）

```bash
# 1. 复制整个项目
xcopy /E /I tauri-app my-new-app
cd my-new-app

# 2. 删除不需要的文件
rm -rf .git
rm -rf src-tauri/target
rm -rf src-tauri/gen/android
rm -rf node_modules
rm -rf dist
rm build-logs/*.log

# 3. 修改项目名
# 编辑 package.json -> "name": "my-new-app"
# 编辑 src-tauri/tauri.conf.json -> "productName": "my-new-app"
# 编辑 src-tauri/Cargo.toml -> name = "my-new-app"

# 4. 重新安装依赖
bun install

# 5. 初始化 Android（如果需要）
bun run tauri android init

# 6. 启动开发
.\dev.ps1 desktop
```

### 方法 2: 使用 Tauri CLI 创建 + 脚本移植

```bash
# 1. 创建新项目
bun create tauri-app@latest my-new-app
# 选择: React + TypeScript + Bun

cd my-new-app

# 2. 从模板复制脚本
xcopy ..\tauri-app\build-*.ps1 .
xcopy ..\tauri-app\dev.ps1 .
xcopy ..\tauri-app\README-Scripts.md .

# 3. 完成
```

## 必须修改的文件清单

| 文件 | 修改内容 |
|------|----------|
| `package.json` | `"name": "新项目名称"` |
| `src-tauri/tauri.conf.json` | `"productName": "显示名称"`, `"identifier": "com.company.app"` |
| `src-tauri/Cargo.toml` | `name = "rust_crate_name"` |
| `src-tauri/src/lib.rs` | 包名（如果改了 Cargo.toml name）|
| `index.html` | `<title>` 标签内容 |
| `src/App.tsx` | 应用标题和欢迎语 |

## 脚本路径检查

复制后检查脚本中的硬编码路径：

```powershell
# build-android-auto.ps1 中检查：
$Config = @{
    Java17 = "D:\data\AndroidStudioSDK\java17"      # ← 你的 Java 路径
    AndroidSdk = "D:\data\AndroidStudioSDK"        # ← 你的 SDK 路径
}
```

## 最小可用模板（仅核心）

如果你只想保留最精简的模板：

```
my-minimal-template/
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   └── App.css
├── src-tauri/
│   ├── src/lib.rs
│   ├── capabilities/default.json
│   ├── Cargo.toml
│   └── tauri.conf.json
├── build-android-auto.ps1      # ⭐
├── build-desktop-v2.ps1        # ⭐
├── dev.ps1                     # ⭐
├── vite.config.ts
├── package.json
├── tsconfig.json
└── index.html
```

只需这 13 个文件即可快速启动新项目。

## 验证模板是否工作

```powershell
# 1. 安装
bun install

# 2. 开发模式
.\dev.ps1 desktop

# 3. 构建测试
.\build-desktop-v2.ps1

# 4. Android 测试（如需要）
bun run tauri android init
.\build-android-auto.ps1
```

## 推广给其他开发者

如果要把这个模板给团队用：

1. **Git 仓库** - 上传到 GitHub/GitLab
2. **使用模板功能** - GitHub 可以设为 Template Repository
3. **文档** - 附上 README.md 说明
4. **发布** - 可以发布到 npm/crates.io 作为正式模板

## 相比官方模板的优势

| 特性 | 官方模板 | 此模板 |
|------|---------|--------|
| 创建项目 | `bun create tauri-app` | 复制即可 |
| Android 构建 | 手动配置 Java | ✅ 脚本自动处理 |
| 构建计时 | ❌ | ✅ 分阶段统计 |
| 自动安装 | ❌ | ✅ ADB 自动安装 |
| 一键全平台 | ❌ | ✅ build-all-v2 |
| 日志记录 | ❌ | ✅ 自动保存 |

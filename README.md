# ExoMind

> 本地优先（Local-first / 本地优先）的个人 AI 助手，聚焦事件日志（Event Log / 事件日志）、时间块（TimeBlock / 时间块）与多端同步（Multi-device Sync / 多端同步）。

## 项目概览

ExoMind 是一个基于 Tauri v2 的跨平台应用（Windows/macOS/Linux/Android），前端使用 React + TypeScript，数据层使用 PouchDB（IndexedDB）并支持局域网同步。

当前主线版本：

- App Version（应用版本）: `0.2.1`
- Package Name（包名）: `com.exomind.app`
- Rust Crate（Rust 包名）: `exomind`

## 当前功能（v0.2.1）

| 模块                     | 状态     | 说明                                                |
| ------------------------ | -------- | --------------------------------------------------- |
| Event Log（事件日志）    | 稳定可用 | Markdown 记录、按时间分组、分页加载、JSON 导入导出  |
| TimeBlock（时间块）      | 稳定可用 | 开始/暂停/继续/结束，结束时支持反馈记录             |
| Sync（同步）             | 稳定可用 | 基于 PouchDB 的本地优先同步，支持按用户隔离数据库   |
| Settings（设置）         | 稳定可用 | 主题切换、同步地址覆盖、导入策略、版本/构建哈希展示 |
| Voice / ASR（语音/识别） | 实验中   | 提供语音聊天、ASR 测试与 MOSS 测试页面              |
| User Manage（用户管理）  | 实验中   | 本地注册/登录流程，用于同步能力联调                 |

## 技术栈（Tech Stack / 技术栈）

| 分类                        | 技术                             |
| --------------------------- | -------------------------------- |
| Runtime（运行时）           | Bun                              |
| Frontend（前端）            | React 18 + TypeScript + Vite     |
| Desktop/Mobile（桌面/移动） | Tauri v2                         |
| UI（界面）                  | Tailwind CSS + Radix UI + Lucide |
| State（状态）               | Zustand                          |
| Storage（存储）             | PouchDB（IndexedDB）             |
| Router（路由）              | TanStack Router                  |
| Test（测试）                | Vitest + Playwright              |

## 快速开始（Quick Start / 快速上手）

### 1) 环境要求（Prerequisites / 先决条件）

- Bun（必需）
- Rust stable toolchain（必需）
- Node.js 20+（推荐，与 CI 一致）
- Windows 构建时需要 Visual Studio Build Tools（C++ 构建工具）
- Android 开发需要：
  - Android SDK（建议 API 34+）
  - JDK 17

### 2) 安装依赖（Install / 安装）

```powershell
# 根项目依赖
bun install

# 同步服务依赖（server 子项目）
bun install --cwd server --omit optional
```

### 3) 本地开发（Development / 开发）

```powershell
# Web 前端（默认端口 1420）
bun run dev

# PouchDB 同步服务（默认 127.0.0.1:6984）
bun run server
```

```powershell
# Tauri 桌面开发
bun run tauri dev

# Tauri Android 开发
bun run tauri android dev
```

### 4) 推荐联调方式（Web + Sync / 前后端联调）

```powershell
# 建议在多 worktree 下显式设置端口，避免互相冲突
$env:EXOMIND_WEB_PORT='1760'
$env:EXOMIND_HMR_PORT='1761'
$env:EXOMIND_POUCHDB_PORT='7384'
$env:EXOMIND_POUCHDB_HOST='127.0.0.1'

# 启动同步服务
bun run server

# 新终端启动前端
bun run dev
```

可选一键脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\Scripts\dev\run-test-stack.ps1
```

## 常用命令（Scripts / 常用脚本）

### package.json 脚本

| 命令                          | 作用                              |
| ----------------------------- | --------------------------------- |
| `bun run dev`               | 启动 Vite 开发服务                |
| `bun run dev:sync`          | 通过 `dev.ps1` 启动同步开发流程 |
| `bun run server`            | 启动 PouchDB 同步服务             |
| `bun run tauri dev`         | 桌面端开发                        |
| `bun run tauri android dev` | Android 开发                      |
| `bun run build`             | TypeScript + Vite 构建            |
| `bun run test`              | Vitest 单测                       |
| `bun run test:e2e`          | Playwright E2E                    |
| `bun run gh:comment -- ...` | GitHub Issue/PR 评论自动化        |

### PowerShell 自动化脚本

查看 `Scripts/README.md`，主要分组：

- `Scripts/dev/*.ps1`：开发启动与辅助工具
- `Scripts/build/*.ps1`：桌面/Android 构建
- `Scripts/test/*.ps1`：测试执行

## 环境变量（Environment Variables / 环境变量）

建议从 `.env.example` 复制并调整：

```powershell
Copy-Item .env.example .env
```

核心变量：

| 变量                     | 默认值        | 说明                        |
| ------------------------ | ------------- | --------------------------- |
| `EXOMIND_WEB_PORT`     | `1420`      | Web 开发端口                |
| `EXOMIND_HMR_PORT`     | `1421`      | HMR 端口                    |
| `EXOMIND_POUCHDB_PORT` | `6984`      | 同步服务端口                |
| `EXOMIND_POUCHDB_HOST` | `127.0.0.1` | 同步服务监听地址            |
| `EXOMIND_ASR_PORT`     | `1949`      | ASR 服务端口                |
| `VITE_SYNC_SERVER_URL` | 空            | 前端强制覆盖同步地址        |
| `VITE_ASR_SERVER_URL`  | 空            | 前端强制覆盖 ASR 地址       |
| `VITE_APP_VERSION`     | 自动解析      | 应用显示版本（CI 可注入）   |
| `VITE_BUILD_HASH`      | `local`     | 应用显示构建哈希（CI 注入） |

说明：

- 未设置 `VITE_SYNC_SERVER_URL` 时，前端会按 `当前 hostname + EXOMIND_POUCHDB_PORT` 自动拼接同步地址。
- 局域网联调时，显式设置 `EXOMIND_POUCHDB_HOST=0.0.0.0`，并在客户端填写可达 IP。

## 测试与验收（Testing / 测试）

```powershell
# 单元测试
bun run test

# 指定同步测试
bun run test:sync

# 端到端测试
bun run test:e2e

# Issue 专用 E2E 配置示例
bun run test:e2e:issue27
bun run test:e2e:issue77
bun run test:e2e:issue82
bun run test:e2e:issue120
```

## 构建与发布（Build & Release / 构建发布）

### 本地构建

```powershell
# Web 构建
bun run build

# Tauri 桌面构建（示例：NSIS）
bun run tauri build --bundles nsis

# Android 构建
bun run tauri android init
bun run tauri android build --debug
```

### CI/CD（GitHub Actions）

工作流文件：`.github/workflows/release.yml`

Tag 触发规则：

| Tag 格式 | 触发行为 | Release 类型 |
|---------|---------|-------------|
| `build/v0.3.2-build.20260222T1430` | 构建 + GitHub Release | Pre-release（可直接下载） |
| `release/v0.3.3` | 构建 + GitHub Release | 正式版 |
| `release/v0.3.3-beta.1` | 构建 + GitHub Release | Pre-release（由版本号判断） |

日常使用：

```bash
# 日常构建测试（自动生成时间戳 tag，Releases 页面可直接下载）
bun run build:tag

# 正式发版（先 bump 版本号，再打 tag）
git tag release/v0.3.3 && git push origin release/v0.3.3
```

发布产物命名（归一化后）：

- `ExoMind-v0.3.2-build.20260222T1430-<hash>-windows-x64-setup.exe`
- `ExoMind-v0.3.2-build.20260222T1430-<hash>-windows-x64-installer.msi`（可选）
- `ExoMind-v0.3.2-build.20260222T1430-<hash>-android-arm64.apk`
- `ExoMind-v0.3.2-build.20260222T1430-<hash>-android-x86.apk`

## 项目结构（Repository Layout / 目录结构）

```text
exomind/
├─ src/                 # React 前端与业务逻辑
├─ src-tauri/           # Tauri Rust 侧与打包配置
├─ server/              # PouchDB 同步服务
├─ Scripts/             # PowerShell/Bun 自动化脚本
├─ tests/               # Vitest + Playwright 测试
├─ docs/                # 文档中心（架构/规格/计划）
├─ pm/                  # 项目管理文档
└─ README.md            # 当前文件
```

## 文档索引（Docs / 文档）

- 项目文档导航：`docs/README.md`
- 快速上手：`docs/quickstart.md`
- 架构说明：`docs/architecture.md`
- 技术栈说明：`docs/stack.md`
- 构建指南：`BUILD.md`
- 脚本说明：`Scripts/README.md`
- 开发规范：`CLAUDE.md`

## 常见问题（FAQ / 常见问题）

1. 同步服务启动报 `pouchdb-server 未找到`
   安装 `server` 依赖：`bun install --cwd server --omit optional`。
2. Web 端无法同步
   检查 `EXOMIND_POUCHDB_PORT`、`EXOMIND_POUCHDB_HOST` 与设置页同步地址是否一致。
3. Android 构建失败
   先确认 `JAVA_HOME`、`ANDROID_SDK_ROOT` 与 `bun run tauri android init` 已完成。
4. 多 worktree 端口冲突
   为每个 worktree 设独立 `EXOMIND_WEB_PORT/EXOMIND_HMR_PORT/EXOMIND_POUCHDB_PORT/EXOMIND_ASR_PORT`。

## License

MIT

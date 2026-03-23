# ExoMind

> 本地优先（Local-first / 本地优先）的个人 AI 助手，聚焦事件日志（Event Log / 事件日志）、时间块（TimeBlock / 时间块）与多端同步（Multi-device Sync / 多端同步）。

## CI/CD

- **Black Hat Critic**: PR 自动双关评审（Codex 5.3 + Claude Opus 4.6）

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
# Web 前端（默认尝试 1420，被占用时自动选择空闲端口）
bun run dev

# PouchDB 同步服务（默认 127.0.0.1:6984）
bun run server
```

```powershell
# Tauri 桌面开发（自动探测空闲端口，默认关闭 Tauri watcher 避免无关文件改动触发黑屏）
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
| `bun run tauri:manager -- ...` | 多实例 `tauri dev` 管理器      |
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

| 变量                     | 默认值        | 说明                                          |
| ------------------------ | ------------- | --------------------------------------------- |
| `EXOMIND_WEB_PORT`     | 自动探测      | Web 开发端口（默认尝试 1420，被占用自动切换） |
| `EXOMIND_HMR_PORT`     | WEB+1         | HMR 端口                                      |
| `EXOMIND_POUCHDB_PORT` | `6984`      | 同步服务端口                                  |
| `EXOMIND_POUCHDB_HOST` | `127.0.0.1` | 同步服务监听地址                              |
| `EXOMIND_ASR_PORT`     | `1949`      | ASR 服务端口                                  |
| `EXOMIND_TAURI_INSTANCE_NAME` | 空 | Tauri 开发实例名（用于派生独立构建目录） |
| `EXOMIND_TAURI_TARGET_DIR` | 空 | 显式指定 Tauri/Cargo 开发构建目录 |
| `EXOMIND_TAURI_ENABLE_WATCH` | 空 | 设为 `1/true` 时重新启用 Tauri watcher（Rust 热重载 / Rust hot reload） |
| `VITE_SYNC_SERVER_URL` | 空            | 前端强制覆盖同步地址                          |
| `VITE_ASR_SERVER_URL`  | 空            | 前端强制覆盖 ASR 地址                         |
| `VITE_APP_VERSION`     | 自动解析      | 应用显示版本（CI 可注入）                     |
| `VITE_BUILD_HASH`      | `local`     | 应用显示构建哈希（CI 注入）                   |

说明：

- 未设置 `VITE_SYNC_SERVER_URL` 时，前端会按 `当前 hostname + EXOMIND_POUCHDB_PORT` 自动拼接同步地址。
- 局域网联调时，显式设置 `EXOMIND_POUCHDB_HOST=0.0.0.0`，并在客户端填写可达 IP。
- `bun run tauri dev` 下若未显式设置 `CARGO_TARGET_DIR`，`Scripts/dev/tauri-wrapper.ps1` 会自动注入独立目录，避免 Windows 多开实例时多个 `cargo run` 同时争抢同一个 `target\debug\exomind.exe` 并触发 `拒绝访问 / os error 5`。
- `bun run tauri dev` 现在默认注入 `--no-watch`，避免修改文档、测试或其它无关文件时 Tauri watcher 重建窗口导致黑屏；如需恢复 Rust watcher，可设置 `EXOMIND_TAURI_ENABLE_WATCH=1`。

windows powershell指定端口启动桌面端的例子：

```powershell
$env:EXOMIND_WEB_PORT='1520'; $env:EXOMIND_HMR_PORT='1521'; bun run tauri dev
```

并行启动多个 Tauri 开发实例（parallel Tauri dev / 并行桌面调试）：

```powershell
# 终端 A：较窄窗口
$env:EXOMIND_WEB_PORT='1520'
$env:EXOMIND_HMR_PORT='1521'
$env:EXOMIND_TAURI_INSTANCE_NAME='narrow'
bun run tauri dev

# 终端 B：较宽窗口
$env:EXOMIND_WEB_PORT='1620'
$env:EXOMIND_HMR_PORT='1621'
$env:EXOMIND_TAURI_INSTANCE_NAME='wide'
bun run tauri dev
```

说明：

- `Scripts/dev/tauri-wrapper.ps1` 会在 `tauri dev` 时自动为每个实例注入独立 `CARGO_TARGET_DIR`，默认目录形如 `target/tauri-dev/web-1520`，避免 Windows 上多个 `cargo run` 争抢同一个 `target\debug\exomind.exe`。
- 如需手动指定构建输出目录，可设置 `EXOMIND_TAURI_TARGET_DIR`；若你已自行设置 `CARGO_TARGET_DIR`，wrapper 会直接复用。
- 若未设置 `EXOMIND_TAURI_INSTANCE_NAME`，默认会按 `EXOMIND_WEB_PORT` 生成实例目录名，例如 `web-1520`、`web-1620`，便于同时测试不同 UI 尺寸（UI sizes / 界面尺寸）。
- 若要做局域网多机联调，建议单独启动一个同步服务终端并设置 `EXOMIND_POUCHDB_HOST=0.0.0.0`，各实例再通过 `VITE_SYNC_SERVER_URL=http://<LAN-IP>:<PORT>` 指向同一同步地址。

多实例 `tauri dev` 推荐使用仓库内管理器（instance manager / 实例管理器）：

```powershell
# 启动桌面端实例
bun run tauri:manager -- start --name desktop

# 启动 Android 端实例（需要模拟器或真机已连接）
bun run tauri:manager -- start --name phone --target android

# 查看当前受管实例
bun run tauri:manager -- list

# 跟随日志（实时监听 / live tail）
bun run tauri:manager -- logs --name phone --follow

# 精确停止某一个实例（只杀登记的根 PID 树）
bun run tauri:manager -- stop --name phone

# 清理已退出的实例记录
bun run tauri:manager -- prune
```

可用参数：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--name <name>` | 实例名称 | `<target>-<port>` |
| `--target desktop\|android` | 构建目标平台 | `desktop` |
| `--web-port <port>` | Vite 前端端口 | 自动分配 |
| `--hmr-port <port>` | HMR 端口 | 自动分配 |
| `--watch` | 启用 Tauri 文件监视 | 关闭 |

说明：

- 元数据与日志保存在 `.tmp/tauri-dev-instances/`。
- `--target android` 会执行 `bun tauri android dev`，自动部署到已连接的模拟器或真机。
- 每个实例自动分配独立的 Web/HMR 端口，避免多实例冲突。
- `stop` 只针对该实例登记的根 PID 做树状终止，避免手工 `taskkill /T` 误伤其它实例。

## 测试与验收（Testing / 测试）

```powershell
# 单元测试
bun run test

# 指定同步测试
bun run test:sync

# 端到端测试
bun run test:e2e

# Termux 端到端测试（系统 Chromium）
pkg install x11-repo chromium
export PLAYWRIGHT_TERMUX=1
export PLAYWRIGHT_BROWSERS_PATH=0
export CHROMIUM_PATH=/data/data/com.termux/files/usr/bin/chromium-browser
bun run test:e2e:termux

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

| Tag 格式                             | 触发行为              | Release 类型                |
| ------------------------------------ | --------------------- | --------------------------- |
| `build/v0.3.2-build.20260222T1430` | 构建 + GitHub Release | Pre-release（可直接下载）   |
| `release/v0.3.3`                   | 构建 + GitHub Release | 正式版                      |
| `release/v0.3.3-beta.1`            | 构建 + GitHub Release | Pre-release（由版本号判断） |

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
   dev 端口已支持自动探测空闲端口，通常无需手动配置。如需固定端口，可设置 `EXOMIND_WEB_PORT/EXOMIND_HMR_PORT/EXOMIND_POUCHDB_PORT/EXOMIND_ASR_PORT`。

## License

MIT

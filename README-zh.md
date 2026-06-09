<div align="center">

# ExoMind

**你的生命成长助手。**

本地优先 · 事件驱动 · AI 赋能 · 全平台

[![License: CCOPL-1.0](https://img.shields.io/badge/许可证-CCOPL--1.0-blue.svg)](https://github.com/exomind-team/ccopl)
[![Build](https://img.shields.io/github/actions/workflow/status/exomind-team/exomind/release.yml?branch=dev&label=构建)](https://github.com/exomind-team/exomind/actions)
[![Website](https://img.shields.io/badge/官网-exo--mind.ai-orange)](https://exo-mind.ai)
[![Download](https://img.shields.io/badge/下载-最新版-green)](https://exo-mind.ai/download)

[English](./README.md) · [官网](https://exo-mind.ai) · [下载](https://exo-mind.ai/download)

[![QQ群](https://img.shields.io/badge/QQ群-外心ExoMind-blue?logo=tencentqq)](https://qm.qq.com/q/cmPIiH5BpS)
[![微信](https://img.shields.io/badge/微信-扫码加群-green?logo=wechat)](./docs/wechat.md)

</div>

> [!WARNING]
> **尚未到 1.0 版本 — 存在破坏性变更。** ExoMind 正在活跃开发中，每天都有大量更新。API、数据格式和功能可能随时变化。欢迎参与建设！

---

## 什么是 ExoMind

ExoMind 是一个基于 Tauri v2 的跨平台个人 AI 助手（Windows/macOS/Linux/Android），聚焦事件日志、时间块与多端同步 — 帮助你记录、反思、成长。

<div align="center">
<img src="docs/assets/signal-network.png" alt="ExoMind 信号网络" width="800">
<br>
<em>信号网络 — Agent、Actor 与信号主题协同工作</em>
<br><br>
<img src="docs/assets/voice-input.png" alt="ExoMind 语音输入" width="800">
<br>
<em>语音输入 — 实时语音识别与事件日志记录</em>
</div>

## 技术栈

| 分类 | 技术 |
|------|------|
| 运行时 | Bun |
| 前端 | React 18 + TypeScript + Vite |
| 桌面/移动 | Tauri v2 |
| UI | Tailwind CSS + Radix UI + Lucide |
| 状态管理 | Zustand |
| 存储 | PouchDB (IndexedDB) |
| 路由 | TanStack Router |
| 测试 | Vitest + Playwright |

## 快速开始

### 环境要求

- Bun（必需）
- Rust stable toolchain（必需）
- Node.js 20+（推荐）
- Windows 构建需要 Visual Studio Build Tools (C++)
- Android 开发需要 Android SDK (API 34+) + JDK 17

### 安装与运行

```bash
# 安装依赖
bun install

# Web 开发
bun run dev

# Tauri 桌面开发
bun run tauri dev

# Tauri Android 开发
bun run tauri android dev
```

### 多实例开发

```bash
# 启动桌面端实例
bun tauri:manager start --name desktop

# 启动 Android 端实例
bun tauri:manager start --name phone --target android

# 查看运行中的实例
bun tauri:manager list

# 查看日志
bun tauri:manager logs --name desktop --follow
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `bun run dev` | 启动 Vite 开发服务器 |
| `bun run server` | 启动 PouchDB 同步服务 |
| `bun run tauri dev` | 桌面端开发 |
| `bun run tauri android dev` | Android 开发 |
| `bun run build` | TypeScript + Vite 构建 |
| `bun run test` | 运行单元测试 |
| `bun run test:e2e` | 运行 E2E 测试 |
| `bun run build:tag` | 创建构建标签并触发 CI |

## 环境变量

从 `.env.example` 复制并调整：

```bash
cp .env.example .env
```

核心变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `EXOMIND_WEB_PORT` | 自动 | Vite 开发端口（默认 1420） |
| `EXOMIND_POUCHDB_PORT` | `6984` | 同步服务端口 |
| `EXOMIND_ASR_PORT` | `1949` | ASR 服务端口 |

完整列表见 `.env.example`。

## 项目结构

```
exomind/
├─ src/                 # React 前端与业务逻辑
├─ src-tauri/           # Tauri Rust 后端与配置
├─ crates/              # Rust crates (exomind-runtime)
├─ server/              # PouchDB 同步服务
├─ scripts/             # PowerShell/Bun 自动化脚本
├─ tests/               # Vitest + Playwright 测试
├─ docs/                # 文档（架构、规格、计划）
└─ website/             # 官网源码
```

## 文档

> 文档以中文为主，部分内容提供英文版本。

- [文档索引](docs/README.md) — 全部文档导航
- [开发日志](https://exomind-team.github.io/exomind-devlog/)（中文 · AI 生成 · 实验性）
- [架构概览](docs/architecture/overview.md) — 系统架构设计
- [产品需求](docs/product/PRD.md) — 产品需求文档
- [产品路线图](docs/product/roadmap.md) — 版本规划
- [开发指南](CLAUDE.md) — 开发规范与工作流
- [脚本指南](scripts/README.md) — 脚本使用说明
- [Git 工作流](docs/development/git-spec.md) — Git 分支与提交规范

## 构建与发布

```bash
# 日常构建（自动生成标签，上传到 R2）
bun run build:tag

# 正式发版
git tag release/v0.3.3 && git push origin release/v0.3.3
```

## 社区

| 平台 | 链接 |
|------|------|
| **QQ 群** | [外心 ExoMind 用户交流群](https://qm.qq.com/q/cmPIiH5BpS) |
| **微信** | [扫码加群](./docs/wechat.md) |

## 贡献

欢迎参与贡献！请阅读 [CLAUDE.md](CLAUDE.md) 了解开发规范和工作流程。

## 许可证

本项目采用[贡献者集体所有制公共许可证 v1.0 (CCOPL-1.0)](https://github.com/exomind-team/ccopl)。

详见 [LICENSE](LICENSE) 和 [LICENSE-zh](LICENSE-zh)。

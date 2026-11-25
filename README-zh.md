# 外心 ExoMind

外心用于在本机记录事件、图片、文件和时间块，让你在另一台已授权的设备上接着使用同一份档案。0.6 Beta 使用 Rust 和 SQLite 持久化记录，通过 React、TypeScript 和 Tauri 2 提供界面及系统能力。

[English](README.md) · [官网](https://exo-mind.ai) · [公开下载](https://github.com/exomind-team/exomind/releases) · [许可证](LICENSE-zh)

## 试用 0.6 Beta

需要安装包时，先核对候选的应用提交、构建批次和目标平台。Beta 验证制品位于对应的 GitHub Actions run，正式发行资产在 GitHub Releases。第一次使用可先建档、记一条文字并附上一张图片，再从另一端找到原文并打开原图。[版本与候选证据](docs/AI-CONTEXT.md) · [首次使用指南](docs/product/beta-first-session.md) · [macOS 安装](docs/macos-install.md)

## 快速开始

安装 Node 和 Bun 后，从仓库根执行：

```sh
bun install
bun run dev --host 127.0.0.1 --port 4300 --strictPort
```

打开 `http://127.0.0.1:4300/beta.html?mock=1`。页面上的「内存测试档案」标识对应合成数据，刷新即可重置。要验证重启后的记录，使用独立绝对目录启动真实 Beta Host。[开发快速上手](docs/development/quickstart.md)

| 要做的事 | 从哪里进入 |
|---|---|
| 维护 Beta 前端 | [`beta.html`](beta.html) → [Beta 前端维护入口](src/beta/README.md) |
| 验证记录、时间块和事务回执 | [Beta Core](crates/exomind-core/README.md) |
| 接入 API、同步设备、取得原件 | [Beta Host](crates/exomind-beta-host/README.md) · [架构导览](docs/architecture/README.md) |
| 构建桌面或 Android 候选 | [构建指南](BUILD.md) · [验证层级](docs/development/beta-iteration-guards.md) |
| 维护 Alpha／0.5 | 默认 `index.html` 和 Tauri 默认特性服务于 Alpha／旧 Runtime。[历史架构](docs/architecture/overview.md) |
| 研究独立迁移样本 | [`next/`](next/README.md) 使用自己的 Node 入口和数据根。 |

## 贡献与社区

维护工作从[文档导航](docs/README.md)、[项目协作规则](AGENTS.md)和[计划索引](docs/plans/README.md)进入。相关项目包括 [ExoMind Cell](https://github.com/exomind-team/exomind-cell) 和 [Wattson](https://github.com/exomind-team/wattson)。

[QQ 交流群](https://qm.qq.com/q/cmPIiH5BpS) · [微信](docs/wechat.md) · [CCOPL-1.0](LICENSE) · [中文许可证](LICENSE-zh)

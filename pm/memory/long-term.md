# pm/memory/long-term.md

> exomind 长期记忆
> 版本：v2.0
> 更新：2026-02-03

---

## 核心定位

**exomind 是以 claude code 为核心的跨平台自主生命体系统。**

| 核心功能 | 说明 |
| -------- | ---- |
| **本地 claude code** | 本地 cli 工具，可配置 api 端点，兼容 openai 协议 |
| **多端 agent 编程体验** | 自动运行的 agent，获取输入输出流式处理 |
| **通知拦截聚合** | 移动端 + 桌面端通知统一管理 |

---

## 技术选型

| 决策 | 最终选择 | 理由 |
| ---- | -------- | ---- |
| 跨平台框架 | tauri v2 | 包体积小、native 性能、rust 后端 |
| 后端语言 | rust | 高性能、与 tauri 深度集成 |
| 前端框架 | react | 生态成熟、团队熟悉 |
| 包管理器 | bun | 速度快 |

---

## 架构模块

| 模块 | 优先级 | 状态 |
| ---- | ------ | ---- |
| **claude runner** | p0 | 待开始 |
| **terminal executor** | p0 | 待开始 |
| **signalpool** | p0 | 已完成 |
| **agent layer** | p0 | 已完成 |
| **notification interceptor** | p1 | 待开始 |
| **termux integration** | p1 | 待开始 |

---

## 实施路线图

```
phase 1: claude runner 核心功能 (2-3 周)
├── terminalexecutor 基础实现
├── clauderunner 实现
├── 流式输出处理
├── 前端 terminal 组件
└── claude 配置管理

phase 2: android termux 集成 (2-3 周)
├── termux 检测与安装引导
├── termux command api
├── proot-distro 容器支持
├── android 端 claude 安装
└── 移动端 terminal 适配

phase 3: 通知拦截功能
├── notificationlistenerservice 实现
├── dnd 权限丢失检测与恢复
├── accessibilityservice 备选
├── shizuku 集成
└── lsposed 模块

phase 4: agent 自动化
├── agent 生命周期管理
├── 输入输出流式处理
├── 多会话管理
└── 会话保存/恢复
```

---

## 用户信息

| 字段 | 值 |
| ---- | --- |
| 用户名 | 星林 / haillaylin |
| 系统 | windows + powershell |
| cpu | amd ryzen 9 7950x3d |
| 内存 | 96gb ddr5 |
| 显卡 | amd radeon rx 6750 gre |
| 屏幕 | 4 × 4k 27寸 |

---

## 服务配置

| 配置项 | 值 |
| ------ | --- |
| 服务端口 | **1949** |
| 服务名称 | **exomind** |
| 测试覆盖率 | **100%** |

---

*最后更新: 2026-02-03*

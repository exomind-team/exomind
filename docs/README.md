# ExoMind 文档导航

> 快速定位你需要的文档，降低认知负担

---

## 快速入口（3 分钟）

| 文档 | 说明 | 阅读时间 |
|------|------|----------|
| [README](../README.md) | 项目说明 | 2 分钟 |
| [快速上手](core/quickstart.md) | 5 分钟开始开发 | 5 分钟 |
| [架构总览](core/architecture.md) | 理解系统设计 | 10 分钟 |

---

## 核心文档（30 分钟）

| 文档 | 说明 | 阅读时间 |
|------|------|----------|
| [产品愿景](core/overview.md) | 理解 ExoMind 使命 | 5 分钟 |
| [技术栈](core/stack.md) | 技术选型理由 | 5 分钟 |
| [7 层架构](core/architecture.md) | 详细架构设计 | 15 分钟 |
| [快速上手](core/quickstart.md) | 开发环境搭建 | 5 分钟 |

---

## 开发规格（按需查阅）

### 模块规格

| 文档 | 说明 |
|------|------|
| [SignalPool 规格](specs/modules/SPEC-201-SignalPool.md) | 发布-订阅信号系统 |
| [Agent Layer 规格](specs/modules/SPEC-202-AgentLayer.md) | Agent 业务逻辑层 |

### 架构决策（ADR）

| 文档 | 说明 |
|------|------|
| [ADR-001-why-signal-pool](specs/architecture/ADR-001-why-signal-pool.md) | 为什么选择发布-订阅模式 |
| [ADR-002-why-tauri](specs/architecture/ADR-002-why-tauri.md) | 为什么选择 Tauri |

### API 文档

| 文档 | 说明 |
|------|------|
| [Tauri Commands](specs/api/commands.md) | Tauri 命令参考 |
| [WebSocket API](specs/api/websocket.md) | WebSocket 接口定义 |

---

## 计划与执行

### 当前计划

| 文档 | 说明 |
|------|------|
| [【方案】外心MVP最小闭环设计](plans/%E3%80%90%E6%96%B9%E6%A1%88%E3%80%91%E5%A4%96%E5%BF%83MVP%E6%9C%80%E5%B0%8F%E9%97%AD%E7%8E%B0%E8%AE%BE%E8%AE%A1.md) | MVP 最小闭环设计 |
| [外心四Agent快速实施计划](plans/%E5%A4%96%E5%BF%83%E5%9B%9BAgent%E5%BF%AB%E9%80%9F%E5%AE%9E%E6%96%BD%E8%AE%A1%E5%88%92.md) | 四 Agent 实施计划 |
| [Event Log LAN MVP Plan](plans/2026-02-05-event-log-lan-mvp-plan.md) | Event Log LAN MVP |

### 已归档计划

| 文档 | 说明 |
|------|------|
| [Ralph Loop Enhanced](plans/archive/2026-01-30-ralph-loop-enhanced.md) | 已完成的增强计划 |
| [Chat UI Integration](plans/archive/2026-02-04-chat-ui-integration.md) | 已完成的集成计划 |
| [Multi-device E2E Testing](plans/archive/2026-02-04-multi-device-e2e-testing.md) | 已完成的测试计划 |

---

## 项目管理

| 文档 | 说明 |
|------|------|
| [roadmap.md](../pm/roadmap.md) | 产品路线图 |
| [git-spec.md](../pm/git-spec.md) | Git 使用规范 |
| [memory.md](../pm/memory.md) | 记忆系统 |

---

## 文档重构进度

| 轮次 | 状态 | 完成时间 |
|------|------|----------|
| Round 1: 目录创建 + 移动文档 | ✅ 完成 | 2026-02-05 16:30 |
| Round 2: 合并和简化文档 | ✅ 完成 | 2026-02-05 16:45 |
| Round 3: 清理归档 | ⏳ 待开始 | - |

查看详情: [docs/todo.md](todo.md)

---

## 快速搜索

### 按主题

- **架构设计**: `core/architecture.md`
- **API 参考**: `specs/api/`
- **开发计划**: `plans/`
- **模块规格**: `specs/modules/`

### 按阶段

1. **新手入门**: `core/quickstart.md` → `core/architecture.md` → `core/overview.md`
2. **功能开发**: `core/architecture.md` → `specs/modules/` → `specs/api/`
3. **代码审查**: `pm/git-spec.md` → `specs/architecture/`

---

> 最后更新: 2026-02-05
> 导航版本: v2.0

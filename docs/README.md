# ExoMind 文档导航

> 快速定位你需要的文档，降低认知负担

---

## 文档目录结构

```
docs/
├── README.md                    ← 本文档（导航入口）
├── core/                        ← 核心文档（必读）
│   ├── overview.md             # 产品愿景
│   ├── architecture.md         # 7 层架构总览
│   ├── quickstart.md           # 快速上手指南
│   └── stack.md                # 技术栈总览
├── specs/                       ← 开发规格（按需查阅）
│   ├── architecture/           # 架构决策（ADR）
│   └── modules/                # 模块规格
└── plans/                       ← 计划文档
    ├── *.md                    # 当前计划
    └── archive/                # 已归档计划
```

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
| [SPEC-401-WebSocket](specs/modules/SPEC-401.md) | 移动端 WebSocket |
| [SPEC-501-UserIdentity](specs/modules/SPEC-501-UserIdentity.md) | 用户身份系统 |
| [SPEC-502-PairingSystem](specs/modules/SPEC-502-PairingSystem.md) | 配对系统 |
| [SPEC-503-EncryptedCommunication](specs/modules/SPEC-503-EncryptedCommunication.md) | 加密通信 |
| [模板](specs/modules/TEMPLATE.md) | 规格文档模板 |

### 架构决策（ADR）

| 文档 | 说明 |
|------|------|
| [ADR-003-architecture-unification](specs/architecture/ADR-003-architecture-unification.md) | 架构统一决策 |

---

## 计划与执行

### 当前计划

| 文档 | 说明 |
|------|------|
| [【方案】外心MVP最小闭环设计](plans/%E3%80%90%E6%96%B9%E6%A1%88%E3%80%91%E5%A4%96%E5%BF%83MVP%E6%9C%80%E5%B0%8F%E9%97%AD%E7%8E%B0%E8%AE%BE%E8%AE%A1.md) | MVP 最小闭环设计 |
| [外心四Agent快速实施计划](plans/%E5%A4%96%E5%BF%83%E5%9B%9BAgent%E5%BF%AB%E9%80%9F%E5%AE%9E%E6%96%BD%E8%AE%A1%E5%88%92.md) | 四 Agent 实施计划 |
| [Event Log LAN MVP Plan](plans/2026-02-05-event-log-lan-mvp-plan.md) | Event Log LAN MVP |
| [Ralph Loop Enhanced](plans/2026-01-30-ralph-loop-enhanced.md) | Ralph Loop 增强计划 |
| [Chat UI Integration](plans/2026-02-04-chat-ui-integration.md) | Chat UI 集成计划 |
| [Multi-device E2E Testing](plans/2026-02-04-multi-device-e2e-testing.md) | 多设备 E2E 测试 |
| [Event Log Design](plans/2026-02-05-event-log-design.md) | Event Log 设计 |

### 已归档计划

| 文档 | 说明 |
|------|------|
| [API](plans/archive/API.md) | API 文档（已归档） |
| [AUTONOMOUS_LIFE_SPEC](plans/archive/AUTONOMOUS_LIFE_SPEC.md) | 自主生命规范（已归档） |
| [DEVELOPMENT_PROCESS](plans/archive/DEVELOPMENT_PROCESS.md) | 开发流程（已归档） |
| [ExoMind-Notification-Permission-Guard](plans/archive/ExoMind-Notification-Permission-Guard.md) | 通知权限守护（已归档） |
| [01_ExoBufferConnector技术需求报告](plans/archive/01_ExoBufferConnector技术需求报告.md) | ExoBufferConnector 需求（已归档） |

---

## 项目管理

| 文档 | 说明 |
|------|------|
| [roadmap.md](../pm/roadmap.md) | 产品路线图 |
| [git-spec.md](../pm/git-spec.md) | Git 使用规范 |
| [memory.md](../pm/memory.md) | 记忆系统 |

---

## 快速搜索

### 按主题

- **架构设计**: `core/architecture.md`
- **技术栈**: `core/stack.md`
- **模块规格**: `specs/modules/`
- **开发计划**: `plans/`

### 按阶段

1. **新手入门**: `core/quickstart.md` → `core/architecture.md` → `core/overview.md`
2. **功能开发**: `core/architecture.md` → `specs/modules/` → 相关计划
3. **代码审查**: `pm/git-spec.md` → `specs/architecture/`

---

> 最后更新: 2026-02-05
> 导航版本: v2.1

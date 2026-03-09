# ExoMind 文档导航

> 快速定位你需要的文档，降低认知负担

---

## 一、文档清单与职责

### 1.1 核心文档（必读）

| 文档 | 职责 | 阅读时间 |
|------|------|----------|
| [README.md](./README.md) | 项目说明（本文档） | 1 分钟 |
| [overview.md](./overview.md) | 产品愿景、目标、理念 | 5 分钟 |
| [architecture.md](./architecture.md) | 系统架构设计（7层架构、数据流向） | 15 分钟 |
| [quickstart.md](./quickstart.md) | 开发环境搭建、快速上手 | 10 分钟 |
| [stack.md](./stack.md) | 技术选型理由和版本信息 | 5 分钟 |

**阅读顺序**：README → overview → architecture → quickstart → 开始开发

---

### 1.2 规格文档（按需查阅）

| 文档 | 职责 |
|------|------|
| [ADR-003-architecture-unification.md](./specs/ADR-003-architecture-unification.md) | 架构统一决策记录 |
| [SPEC-401.md](./specs/SPEC-401.md) | 移动端 WebSocket 通信规格 |
| [SPEC-501-UserIdentity.md](./specs/SPEC-501-UserIdentity.md) | 用户身份系统设计 |
| [SPEC-502-PairingSystem.md](./specs/SPEC-502-PairingSystem.md) | 设备配对系统设计 |
| [SPEC-503-EncryptedCommunication.md](./specs/SPEC-503-EncryptedCommunication.md) | 端到端加密通信设计 |
| [TEMPLATE.md](./specs/TEMPLATE.md) | 规格文档模板 |

**ADR**：Architecture Decision Record，架构决策记录

---

### 1.3 计划文档

| 分类 | 文档 | 职责 |
|------|------|------|
| 当前 | [product-plan.md](./plans/product-plan.md) | 产品规划与实施计划（整合版） |
| 当前 | [2026-01-30-ralph-loop-enhanced.md](./plans/2026-01-30-ralph-loop-enhanced.md) | Ralph Loop 增强计划 |
| 当前 | [2026-02-04-chat-ui-integration.md](./plans/2026-02-04-chat-ui-integration.md) | Chat UI 集成计划 |
| 当前 | [2026-02-04-multi-device-e2e-testing.md](./plans/2026-02-04-multi-device-e2e-testing.md) | 多设备 E2E 测试计划 |
| 当前 | [2026-02-05-event-log-design.md](./plans/2026-02-05-event-log-design.md) | Event Log 设计 |
| 当前 | [2026-02-05-event-log-lan-mvp-plan.md](./plans/2026-02-05-event-log-lan-mvp-plan.md) | Event Log LAN MVP |
| 归档 | [plans/archive/](./plans/archive/) | 已完成的计划（不再维护） |

---

### 1.4 开发与运行文档

| 文档 | 职责 |
|------|------|
| [development/exomind-runtime-agents-api.md](./development/exomind-runtime-agents-api.md) | Runtime Agent HTTP/SSE 接口说明（含 `session_id` 复用） |
| [development/issue-tracking-compass.md](./development/issue-tracking-compass.md) | Issue 追踪罗盘（查重→决策→新建/追加→关联） |

---

## 二、软件工程文档规范

本项目遵循软件工程最佳实践，文档分为以下层次：

```
┌─────────────────────────────────────────────────────────────┐
│                    文档层次结构                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  L1. 项目说明（README.md）                                  │
│      ↓                                                      │
│  L2. 理解层（overview.md, architecture.md, stack.md）       │
│      ↓                                                      │
│  L3. 指南层（quickstart.md）                                │
│      ↓                                                      │
│  L4. 规格层（specs/*.md）                                   │
│      ↓                                                      │
│  L5. 计划层（plans/*.md）                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

| 层次 | 文档类型 | 受众 | 目的 |
|------|----------|------|------|
| **L1 项目说明** | README.md | 所有人 | 项目导航 |
| **L2 理解层** | overview, architecture, stack | 新成员 | 理解系统是什么、为什么 |
| **L3 指南层** | quickstart | 开发者 | 快速开始开发 |
| **L4 规格层** | specs/*.md | 开发者 | 详细实现规格 |
| **L5 计划层** | plans/*.md | 开发者 | 跟踪开发进度 |

---

## 三、目录结构

```
docs/
├── README.md                    ← 项目导航（本文档）
├── overview.md                 ← 产品愿景与目标
├── architecture.md             ← 系统架构设计
├── stack.md                   ← 技术选型
├── quickstart.md              ← 快速上手指南
├── specs/                     ← 详细规格（按需查阅）
│   ├── ADR-003-architecture-unification.md
│   ├── SPEC-401.md
│   ├── SPEC-501-UserIdentity.md
│   ├── SPEC-502-PairingSystem.md
│   ├── SPEC-503-EncryptedCommunication.md
│   └── TEMPLATE.md
└── plans/                     ← 开发计划
    ├── *.md                  # 当前计划
    └── archive/              # 已归档计划
```

---

## 四、按场景查找文档

| 场景 | 要找的文档 |
|------|------------|
| **我是新成员，想了解项目** | overview.md → architecture.md → quickstart.md |
| **我要开发新功能** | architecture.md → specs/*.md → 相关计划 |
| **我要做技术选型** | stack.md → specs/ADR-*.md |
| **我要添加规格文档** | specs/TEMPLATE.md → 按模板编写 |
| **我要查看开发进度** | plans/*.md |
| **我要知道为什么这么设计** | specs/ADR-*.md |

---

## 五、项目管理

| 文档 | 路径 | 职责 |
|------|------|------|
| 路线图 | [pm/roadmap.md](../pm/roadmap.md) | 产品迭代计划 |
| Git 规范 | [pm/git-spec.md](../pm/git-spec.md) | Git 使用规范 |
| 记忆系统 | [pm/memory.md](../pm/memory.md) | Ralph Loop 记忆归档 |

---

> 最后更新: 2026-02-05
> 导航版本: v3.0

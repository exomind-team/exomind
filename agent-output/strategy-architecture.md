# 整合规划报告：ExoMind 架构演进路径

> **评审人：** Migration Strategist
> **日期：** 2026-02-08
> **评审范围：** 7 层架构 + 当前实现状态 → 完整架构

---

## 1. 当前状态评估

### 1.1 现有架构（已实现）

| 层级 | 模块 | 状态 | 说明 |
|------|------|------|------|
| **L7-UI** | React + shadcn/ui | ✅ | 聊天、设置、布局页面 |
| **L6-业务逻辑** | Claude Runner | ❌ | 未实现 |
| | Agent Layer | ❌ | 未实现 |
| **L5-SignalPool** | 发布-订阅系统 | ❌ | 未实现 |
| **L4-执行器** | WebSocket 客户端 | ⚠️ | 框架完成，需后端 |
| | P2P 管理器 | ⚠️ | 类型完成，逻辑待实现 |
| **L3-平台适配** | Tauri 适配 | ✅ | 基础功能 |
| | Web 降级 | ⚠️ | 刚修复消息持久化 |

### 1.2 已有 ADR（架构决策）

| ADR | 状态 | 影响范围 |
|-----|------|----------|
| ADR-003: FileStorage 抽象 | ✅ 已批准 | 存储层重构 |
| ADR-004: WebSocket 重构 | ✅ 已批准 | 消息队列 + 重连 |
| ADR-001: SignalPool 选择 | ❌ 未创建 | 发布-订阅架构 |
| ADR-002: libp2p 集成 | ❌ 未创建 | P2P 同步 |

---

## 2. 整合路径分析

### 2.1 与现有代码的边界

```
现有代码                          新架构
   │                                 │
   ▼                                 ▼
┌─────────────┐              ┌─────────────────┐
│ chat-store │              │ Claude Runner    │ L6
│ timeblock  │              │ Agent Layer      │
│   store    │              └─────────────────┘
└─────────────┘                       │
        │                             │
        ▼                             ▼
┌─────────────┐              ┌─────────────────┐
│ p2p/types   │              │ SignalPool       │ L5
│ ws/client   │              │ (发布-订阅)      │
└─────────────┘              └─────────────────┘
        │                             │
        └──────────┬──────────────────┘
                   ▼
            ┌─────────────────┐
            │ 执行器 + 适配器  │ L4-L3
            └─────────────────┘
```

### 2.2 需要修改的组件

| 组件 | 修改类型 | 说明 |
|------|----------|------|
| `chat-store.ts` | 重构 | 集成 SignalPool |
| `timeblock-store.ts` | 重构 | 集成 SignalPool |
| `ws/client.ts` | 重构 | 集成消息队列 |
| `p2p/manager.ts` | 重构 | 集成冲突解决 |
| 新增 `signal-pool.ts` | 新建 | 发布-订阅核心 |
| 新增 `claude-runner.ts` | 新建 | LLM 集成 |
| 新增 `agent-layer.ts` | 新建 | Agent 协调 |

---

## 3. 分阶段实现计划

### 阶段 1：基础稳固（P0）

**目标：** 修复现有 Bug，完善平台适配

```
阶段 1: 基础稳固
├── 目标：修复 PR #15 Bug，完善 Web 端适配
├── 涉及文件：
│   ├── src/lib/sync/message-storage.ts  ✅ 已修复
│   ├── src/components/Chat/ChatPage.tsx  🟡 移除 + 按钮
│   └── src/lib/stores/chat-store.ts
├── 验收标准：
│   ├── Web 端消息持久化正常
│   ├── 聊天页面功能正常
│   └── 无控制台错误
└── 预估轮次：1 轮
```

### 阶段 2：存储层重构（P1）

**目标：** 完成 ADR-003、ADR-004

```
阶段 2: 存储层重构
├── 目标：统一存储抽象，完善消息队列
├── 涉及文件：
│   ├── src/lib/db/types.ts (新建)
│   ├── src/lib/db/errors.ts (新建)
│   ├── src/lib/db/storage.ts (新建)
│   ├── src/lib/db/jsonl.ts (重构)
│   ├── src/lib/sync/ws-errors.ts (新建)
│   ├── src/lib/sync/ws-queue.ts (新建)
│   ├── src/lib/sync/ws-events.ts (新建)
│   └── src/lib/sync/websocket-client.ts (重构)
├── 验收标准：
│   ├── 统一的 Storage 接口
│   ├── 消息队列正常工作
│   ├── 自动重连机制生效
│   └── WebSocket 错误码统一
└── 预估轮次：2-3 轮
```

### 阶段 3：P2P 同步基础（P1）

**目标：** 实现设备发现、配对、基础同步

```
阶段 3: P2P 同步基础
├── 目标：实现多设备基础同步
├── 涉及文件：
│   ├── src/lib/p2p/manager.ts (重构)
│   ├── src/lib/p2p/discovery.ts (新建)
│   ├── src/lib/p2p/conflict.ts (新建)
│   ├── src-tauri/src/commands/p2p_commands.rs (新建/重构)
│   └── tests/e2e/p2p.spec.ts (新建)
├── 验收标准：
│   ├── 设备发现正常
│   ├── 配对流程完整
│   ├── 消息能同步到对端
│   └── 冲突时有简单处理策略
└── 预估轮次：2-3 轮
```

### 阶段 4：SignalPool 发布-订阅（L5）

**目标：** 实现 L5 层，解耦组件通信

```
阶段 4: SignalPool 发布-订阅
├── 目标：实现 L5 层架构
├── 涉及文件：
│   ├── src/lib/signal-pool/index.ts (新建)
│   ├── src/lib/signal-pool/types.ts (新建)
│   ├── src/lib/signal-pool/publisher.ts (新建)
│   ├── src/lib/signal-pool/subscriber.ts (新建)
│   ├── src/lib/signal-pool/dispatcher.ts (新建)
│   └── docs/architecture/DECISIONS/ADR-001.md (新建)
├── 验收标准：
│   ├── 组件间通过 Signal 通信
│   ├── 发布/订阅机制正常
│   ├── 信号路由正确
│   └── 性能可接受（无明显延迟）
└── 预估轮次：2 轮
```

### 阶段 5：Agent Layer（L6）

**目标：** 实现四 Agent 架构

```
阶段 5: Agent Layer
├── 目标：实现 L6 层，四 Agent 协调
├── 涉及文件：
│   ├── src/lib/agents/supervisor.ts (新建)
│   ├── src/lib/agents/governor.ts (新建)
│   ├── src/lib/agents/growth-coach.ts (新建)
│   ├── src/lib/agents/review-agent.ts (新建)
│   ├── src/lib/agents/types.ts (新建)
│   ├── src/lib/agents/message-router.ts (新建)
│   └── docs/architecture/DECISIONS/ADR-002.md (新建)
├── 验收标准：
│   ├── Supervisor 路由消息
│   ├── Governor 调控输出
│   ├── Growth Coach 提供建议
│   └── Review Agent 复盘功能
└── 预估轮次：3-4 轮
```

### 阶段 6：Claude Runner（L6 扩展）

**目标：** 集成 Claude API，实现 AI 能力

```
阶段 6: Claude Runner
├── 目标：集成 Claude LLM 能力
├── 涉及文件：
│   ├── src/lib/agents/claude-runner.ts (新建)
│   ├── src/lib/agents/prompt-templates.ts (新建)
│   ├── src/lib/agents/context-manager.ts (新建)
│   ├── src/lib/agents/token-tracker.ts (新建)
│   └── tests/unit/agents.spec.ts (新建)
├── 验收标准：
│   ├── Claude API 正常调用
│   ├── 上下文管理正常
│   ├── Token 使用追踪
│   └── 响应时间可接受
└── 预估轮次：2-3 轮
```

### 阶段 7：CRDT 同步（可选 P2）

**目标：** 实现真正的多设备协作编辑

```
阶段 7 (可选): CRDT 同步
├── 目标：解决 P2P 冲突问题
├── 涉及文件：
│   ├── src/lib/sync/yjs-adapter.ts (新建)
│   ├── src/lib/sync/crdt-types.ts (新建)
│   ├── src/lib/sync/auto-merger.ts (新建)
│   └── tests/unit/crdt.spec.ts (新建)
├── 验收标准：
│   ├── 多设备同时编辑不冲突
│   ├── 自动合并正常工作
│   └── 性能可接受
└── 预估轮次：3-4 轮
```

---

## 4. 编程轮次估算

### 4.1 总轮次估算

| 阶段 | 名称 | 轮次 | 产出 |
|------|------|------|------|
| 1 | 基础稳固 | 1 | Bug 修复，移除 + 按钮 |
| 2 | 存储层重构 | 2-3 | 统一存储，消息队列 |
| 3 | P2P 同步基础 | 2-3 | 设备发现，配对，基础同步 |
| 4 | SignalPool | 2 | 发布-订阅核心 |
| 5 | Agent Layer | 3-4 | 四 Agent 架构 |
| 6 | Claude Runner | 2-3 | LLM 集成 |
| 7 (可选) | CRDT 同步 | 3-4 | 冲突解决 |
| **总计** | | **15-21 轮** | |

### 4.2 里程碑划分

| 里程碑 | 阶段 | 轮次 | 目标 |
|--------|------|------|------|
| M1: MVP 稳定 | 1 | 1 | 现有功能稳定 |
| M2: 消息可靠 | 2 | 2-3 | 存储重构完成 |
| M3: 多设备 | 3 | 2-3 | P2P 基础同步 |
| M4: 架构完整 | 4+5 | 5-6 | L5+L6 完成 |
| M5: AI 增强 | 6 | 2-3 | Claude 集成 |
| M6: 协作编辑 | 7 (可选) | 3-4 | CRDT 完成 |

---

## 5. 风险评估

### 5.1 高风险项

| 风险 | 影响 | 缓解策略 |
|------|------|----------|
| Web 端持久化不稳定 | P0 | 添加容量检测、优雅降级 |
| P2P 同步复杂度高 | P1 | 分阶段实现，先完成基础同步 |
| Claude API 成本 | P2 | Token 追踪、缓存策略 |
| 架构改动影响现有功能 | P1 | 每个阶段独立测试 |

### 5.2 中风险项

| 风险 | 影响 | 缓解策略 |
|------|------|----------|
| SignalPool 设计不合理 | P2 | 参考成熟方案（RxJS、EventEmitter） |
| Agent 协调复杂 | P2 | 简化版本开始，逐步增强 |
| WebSocket 后端延迟 | P2 | 前端重连机制完善 |

### 5.3 低风险项

| 风险 | 影响 | 缓解策略 |
|------|------|----------|
| CRDT 实现难度 | P3 | 作为可选阶段 |
| 插件系统扩展 | P3 | 最后实现 |

---

## 6. 回退方案

### 6.1 每个阶段的回退策略

| 阶段 | 回退方案 |
|------|----------|
| 1 | Git revert |
| 2 | 保留旧的存储代码为 `#if Tauri` 分支 |
| 3 | P2P 管理器降级为无同步模式 |
| 4 | SignalPool 作为可选，核心功能直接调用 |
| 5 | Agent Layer 默认为 passthrough 模式 |
| 6 | Claude Runner 可禁用 |
| 7 | 不实现 CRDT，使用简单最后写入胜出 |

### 6.2 数据迁移策略

- 每次存储格式变更提供迁移脚本
- 保留向后兼容性至少一个版本
- 数据备份在每次重构前自动执行

---

## 7. 依赖关系

### 7.1 阶段依赖

```
阶段 1 (基础稳固)
    │
    ▼
阶段 2 (存储重构) ─────┐
    │                  │
    ▼                  ▼
阶段 3 (P2P)    阶段 4 (SignalPool)
    │                  │
    └────────┬─────────┘
             ▼
        阶段 5 (Agent Layer)
             │
             ▼
        阶段 6 (Claude Runner)
             │
             ▼
    阶段 7 (可选 CRDT)
```

### 7.2 外部依赖

| 依赖 | 版本 | 用途 | 风险 |
|------|------|------|------|
| Claude API | latest | LLM 能力 | API 变更 |
| libp2p | 0.44+ | P2P 同步 | Rust 版本兼容 |
| Yjs | 13+ | CRDT (可选) | 依赖冲突 |

---

## 8. 建议

### 8.1 短期建议

1. **优先完成阶段 1（基础稳固）**
   - PR #15 Bug 已修复
   - 移除 + 按钮
   - 充分测试 Web 端持久化

2. **创建缺失的 ADR**
   - ADR-001: SignalPool 架构选择
   - ADR-002: libp2p 集成方案

### 8.2 中期建议

1. **存储层优先于 P2P**
   - 存储是 P2P 的基础
   - ADR-003/ADR-004 需优先完成

2. **SignalPool 为 Agent Layer 铺路**
   - L5 是 L6 的通信基础
   - 尽早实现，避免后期大改

### 8.3 长期建议

1. **CRDT 作为可选目标**
   - 实现难度高
   - 考虑使用 Yjs 等成熟方案

2. **插件系统最后考虑**
   - 当前架构不稳定
   - 插件 API 会频繁变更

---

## 9. 总结

### 实施路线图

| 时间 | 里程碑 | 轮次 |
|------|--------|------|
| 第 1-2 周 | M1: MVP 稳定 | 1 轮 |
| 第 3-6 周 | M2: 消息可靠 | 2-3 轮 |
| 第 7-10 周 | M3: 多设备 | 2-3 轮 |
| 第 11-14 周 | M4: 架构完整 | 5-6 轮 |
| 第 15-18 周 | M5: AI 增强 | 2-3 轮 |
| 第 19-26 周 | M6: 协作编辑 (可选) | 3-4 轮 |

### 关键成功因素

1. **每个阶段独立可测试**
2. **保持向后兼容**
3. **数据备份在每次变更前**
4. **灵活应对架构调整**

---

## 参考文档

1. `docs/architecture/MVP.md` - MVP 架构设计
2. `docs/architecture/MVP-ARCHITECTURE.md` - 详细架构文档
3. `docs/architecture/DECISIONS/ADR-003-why-refactor-storage.md`
4. `docs/architecture/DECISIONS/ADR-004-why-refactor-websocket.md`
5. `agent-output/critic-architecture.md` - Architecture Critic 报告
6. `agent-output/investigate-architecture.md` - Code Investigator 报告

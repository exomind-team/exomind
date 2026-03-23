# ExoMind 架构设计 v4.0

> **核心原则**: 渐进式演进，每个阶段都是可发布的产品状态
> **更新日期**: 2026-02-08

---

## 1. 分层架构

自底向上构建，每层都有运行时实体。

```
L4  UI ──────── React + zustand，只调 Service
    │
    │  ← Service interface（L3 向上暴露，谁提供谁定义）
    │
L3  Service / Actor / Agent ── 业务逻辑层
    │
    │  ← ActorContext interface（L3 定义自己需要的环境访问权限）
    │
L2  Environment ── 共享物理世界
    │               · 持有 Port 实例（能力）
    │               · 资源池（周期刷新型 + 总额有限型）
    │               · 消息缓冲（短期记录，自动淘汰）
    │               · 独占资源管理（acquire / release）
    │
    │  ← Port interface（L2 定义，谁消费谁定义）
    │
L1  Adapter ──── 具体实现，按运行时替换
                 Web: IndexedDB, fetch, Web Speech, WebContainer
                 Tauri: SQLite, Rust HTTP, Native Shell
```

### 1.1 接口归属规则

| 接缝 | 接口放在 | 原则 | 本质 |
|------|----------|------|------|
| L1 ↔ L2 | Port interface 放 L2 | 谁消费谁定义 | 类型契约 |
| L2 ↔ L3 | ActorContext 放 L3 | 谁消费谁定义 | 权限边界 |
| L3 ↔ L4 | Service interface 放 L3 | 谁提供谁定义 | API 暴露 |

**核心逻辑**: 接口永远归更稳定的一方所有。业务比 UI 稳定，所以 Service 接口归 L3。环境需求比具体实现稳定，所以 Port 接口归 L2。

### 1.2 文件组织

接口跟它归属的层放在一起，每层目录下有 `interfaces/` 子目录。

```
src/
├── adapters/           # L1
│   ├── llm/
│   ├── asr/
│   ├── tts/
│   ├── storage/
│   ├── terminal/
│   ├── crypto/
│   └── platform/
│
├── environment/        # L2
│   ├── interfaces/     #   Port interface 定义
│   │   ├── llm.port.ts
│   │   ├── asr.port.ts
│   │   ├── tts.port.ts
│   │   ├── storage.port.ts
│   │   ├── terminal.port.ts
│   │   ├── sandbox.port.ts
│   │   ├── platform.port.ts
│   │   ├── event-bus.port.ts
│   │   └── crypto.port.ts
│   ├── environment.ts  #   Environment 实现
│   ├── resource-pool.ts
│   ├── message-buffer.ts
│   └── bootstrap.ts    #   运行时检测 → 组装 Adapter → 创建 Environment
│
├── services/           # L3（Phase 1-2：普通 Service）
│   ├── interfaces/     #   Service interface（向 L4 暴露）
│   │   ├── chat.service.ts
│   │   ├── task.service.ts
│   │   ├── event-log.service.ts
│   │   └── review.service.ts
│   └── impl/           #   Service 实现
│       ├── chat.service.impl.ts
│       ├── task.service.impl.ts
│       ├── event-log.service.impl.ts
│       └── review.service.impl.ts
│
├── actor/              # L3（Phase 4 引入，与 services/ 并存）
│   ├── interfaces/     #   ActorContext 等
│   │   ├── actor.ts
│   │   ├── agent.ts
│   │   └── context.ts
│   ├── mailbox.ts
│   ├── supervisor.ts
│   ├── system.ts
│   ├── actors/         #   具体 Actor
│   │   ├── sense/
│   │   └── exec/
│   └── agents/         #   具体 Agent（LLM 驱动）
│       ├── governor.agent.ts
│       ├── task-system.agent.ts
│       ├── growth-coach.agent.ts
│       └── review.agent.ts
│
├── ui/                 # L4
│   ├── components/
│   ├── pages/
│   ├── hooks/
│   ├── stores/
│   └── providers/
│       └── RuntimeProvider.tsx
│
└── main.tsx
```

---

## 2. Port 定义

Port 按实际能力定义读写方向，不全是 readonly。

| Port | 职责 | 读 | 写 | 双向 |
|------|------|---|---|------|
| ILLMPort | 大语言模型推理 | | | ✅ 写入 prompt，读取 response |
| IASRPort | 语音识别 | ✅ 读取音频流转文字 | | |
| ITTSPort | 语音合成 | | ✅ 写入文字输出音频 | |
| IStoragePort | 持久化存储 | | | ✅ 读写数据 |
| ITerminalPort | 终端执行 | | | ✅ 写入命令，读取输出 |
| ISandboxPort | 沙箱脚本执行 | | | ✅ 写入代码，读取结果 |
| IPlatformPort | 平台能力 | | | ✅ 通知、文件、系统集成 |
| IEventBusPort | 事件总线 | | | ✅ 发布 + 订阅 |
| ICryptoPort | 加密解密 | | | ✅ 加密 + 解密 |

Environment 还提供只读能力：
- `capabilities()` — 探测当前运行时支持哪些能力
- `resources` — 查看公共资源池状态（只有资源感知模块可更新）

---

## 3. Environment — 共享物理世界

### 3.1 三个职责

**持有 Port 实例（能力）。** 所有 Adapter 在 bootstrap 时注入，所有 Service/Actor 通过 Environment 使用。类比：鱼缸里的水和氧气。

**管理资源池（约束）。** 两种真实资源：

| 类型 | 类比 | 行为 | 示例 |
|------|------|------|------|
| 周期刷新型 | 氧气 | 每 N 小时刷新限额，用完等下一周期 | API 限额每 5h 刷新 |
| 总额有限型 | 脂肪储备 | 用完靠外部补充（用户充值） | 预付费 10 元余额 |

**维护消息缓冲（短期记忆）。** 所有经过系统的信号留痕，保留最近一段时间（如 5 分钟或最近 500 条），超时自动淘汰。任何 Service/Actor 可回看。长期记忆由上层自行决定提取和存储。

注意：高频低价值消息（如 LLM streaming chunk）不进缓冲，只记录请求/响应级别的完整消息。

### 3.2 独占资源

某些能力不能并发使用（同一时间只能播一个声音、终端独占会话）。通过 `acquire()` 申请，`release()` 释放，持有者死亡时自动释放。

---

## 4. Actor / Agent 模型（Phase 4 引入）

### 4.1 Actor vs Agent

| | Actor | Agent |
|---|---|---|
| 智能 | 无，机械执行 | 有，LLM 驱动 |
| 能量单位 | CPU 时间 / 内存 / 存储空间 | Token（+ 继承 Actor 的资源约束） |
| 内部能量池 | 最终统一，初期不做 | 有，从公共资源池"呼吸"补充 |
| 沙箱执行 | 原生能力（通过 ISandboxPort） | 原生能力 + LLM 生成代码自执行 |
| 通信 | 有界邮箱，异步消息 | 同 Actor |
| 示例 | 通知监听、定时器、TTS 播放 | Governor、Task System、Growth Coach |

### 4.2 去中心化

没有中央路由器。每个 Agent 自己订阅自己关心的信号源（通过 EventBus），自己判断是否处理。

Governor 不是路由器，是调控器——只管能量预算、输出治理、系统级调控。

### 4.3 能量系统

```
公共资源池（Environment 层）
  ├── 周期刷新型（API 限额）
  └── 总额有限型（预付费余额）
        │
        │ "呼吸"：每次请求从公共池获取
        │ 受摄取速率上限约束（如细胞膜）
        ▼
Agent 内部能量池（私有）
  · 公共充足 → 正常呼吸补充
  · 公共耗尽 → 靠内部储备运转
  · 内部也尽 → 休眠（等待恢复）
```

每个 Agent 自己读取资源状态，自己决定行为策略，无中央调度。

### 4.4 Supervisor 监督树

管理 Actor/Agent 的完整生命周期：spawn（发育）→ 运行 → 衰退（资源耗尽）→ 死亡（回收）→ 遗产（经验提取再利用）。

| 策略 | 行为 | 适用 |
|------|------|------|
| one-for-one | 谁崩重启谁 | 子 Actor 互相独立 |
| one-for-all | 一个崩全部重启 | 子 Actor 强关联 |
| rest-for-one | 崩的和它之后的都重启 | 有依赖顺序 |

可存活区间：`maxRestarts` 次 / `window` 时间内。超过 = 跌出可存活区间 → 向上冒泡。

### 4.5 有界邮箱

| 溢出策略 | 行为 | 适用场景 |
|----------|------|----------|
| dropOldest | 丢最旧的 | 感知类（旧通知不重要） |
| dropNewest | 拒绝新的 | 执行类（正在忙，别催） |
| backpressure | 让发送方等 | 关键消息（不能丢） |

注意：JS 单线程环境下 backpressure 是弱实现（返回 Promise，发送方自行决定是否等待），实际可能退化为 dropNewest。

---

## 5. Service 层 — UI 的门面

Service 把底层机制包装成简单的方法调用 + 回调。

Phase 1-2：Service 直接调 Port。
Phase 4：Service 内部转为 Actor 消息，UI 完全无感知。

```typescript
// Phase 1: Service 直接调 Port
class ChatServiceImpl implements IChatService {
  constructor(private env: Environment) {}

  async sendMessage(text: string): Promise<ChatResponse> {
    const response = await this.env.llm.complete(...)
    await this.env.storage.put(...)   // 记录事件日志
    return response
  }
}

// Phase 4: Service 改为 Actor 消息（UI 不用改）
class ChatServiceImpl implements IChatService {
  constructor(private actorSystem: IActorSystem, private eventBus: IEventBusPort) {}

  sendMessage(text: string) {
    this.actorSystem.send({ type: 'sense:user-input', body: { content: text } })
  }

  onResponse(callback: (msg: ChatResponse) => void) {
    return this.eventBus.on('chat:response', callback)
  }
}
```

**关键：IChatService 接口不变，UI 代码不用改。**

---

## 6. 信息流

### 6.1 Phase 1（直接调用链）

```
用户语音输入
  → IASRPort (Web Speech API) 转文字
  → ChatService.sendMessage(text)
  → ILLMPort (Cloud API) 处理
  → IStoragePort (IndexedDB) 记录事件日志
  → 时间块记录
  → LLM 生成反馈
  → UI 渲染
```

线性流程，无 Actor，无 EventBus。

### 6.2 Phase 2（EventBus 解耦）

```
用户完成任务
  → ChatService 发布事件到 EventBus
      ├→ EventLogService 订阅 → 记录日志
      ├→ TimeBlockService 订阅 → 更新时间块
      └→ AgentFeedbackService 订阅 → LLM 分析反馈
```

一个事件多个消费者，通过发布订阅解耦。

### 6.3 Phase 4（Actor 模型）

```
用户输入
  → Service 投消息到 Actor 邮箱
  → 各 Agent 自行订阅 EventBus，自行判断处理
  → Agent 通过 Environment 使用 Port 能力
  → 结果通过 EventBus 回到 Service
  → Service 回调 UI
```

全程异步，去中心化，单点崩溃不影响全局。

---

## 7. 渐进式实施路线

不重构现有项目，在加功能的过程中逐步迁移到新架构。每个 Phase 结束都是可发布的产品状态。

### Phase 1 — 引入 Port 层，跑通输入流（2-3 周）

**目标**: 语音输入 → LLM 处理 → 事件日志 → 时间块 → Agent 反馈

**做的事**:
- 定义 Port interface（ILLMPort, IASRPort, IStoragePort）
- 实现 Web Adapter（Cloud API, Web Speech, IndexedDB）
- 创建 Environment（此阶段仅作 Port 容器，不做资源池和缓冲）
- 创建 Service 层（普通 class，直接调 Port）
- UI 通过 Service 交互

**不做**: Actor、EventBus、能量系统、Supervisor

**产出**: Web 版可用的语音输入 + 智能反馈产品

### Phase 2 — 引入 EventBus（第 4-6 周）

**目标**: 一个事件多个消费者，解耦 Service 间依赖

**做的事**:
- 实现 IEventBusPort（SignalPool Adapter）
- Service 改为发布/订阅模式
- 多个功能模块可以独立响应同一事件

**不做**: Actor、能量系统、Supervisor

**产出**: 更解耦的功能模块，加新功能不影响旧功能

### Phase 3 — 完善 Environment（第 7-8 周）

**目标**: 资源管控 + 可观测性

**做的事**:
- Environment 加入资源池（跟踪 API 限额和预付费余额）
- Environment 加入消息缓冲（短期记忆）
- 资源感知模块定期查询 API usage 更新资源状态
- Service 根据资源状态做降级决策

**不做**: Actor、Supervisor

**产出**: API 限额快用完时自动降级，不会突然断服务

### Phase 4 — 引入 Actor / Agent（更后面）

**目标**: 多 Agent 独立运行，错误隔离

**做的事**:
- 实现 ActorSystem（单线程事件循环 + BoundedMailbox）
- 实现 Supervisor（one-for-one 先行）
- 将业务逻辑从 Service 迁移到 Agent
- Service 退化为 Actor 消息的门面包装
- Agent 内部能量池 + 呼吸机制

**UI 不用改**（因为 Service interface 不变）

**产出**: 多 Agent 并发协作，单个 Agent 崩溃不影响整体

### Phase 5 — 高级生命特性（远期）

- Agent 生命周期完整管理（发育、衰老、死亡、遗产）
- Agent 分裂 / 合并
- 沙箱脚本自执行（DNA → RNA → 蛋白质）
- 普通 Actor 能量统一计量（CPU 时间、内存）

---

## 8. 工程约束与注意事项

### 8.1 浏览器环境限制

| 问题 | 影响 | 应对 |
|------|------|------|
| JS 单线程 | Actor 是协作式并发，不是抢占式 | 每个 receive 加超时保护 |
| backpressure 弱 | 发送方不能被真正阻塞 | 可能退化为 dropNewest |
| 无进程隔离 | 一个 Actor 的未捕获异常影响全局 | 强制要求 receive 内无 unhandled promise |
| 无 link/monitor | Supervisor 无法自动感知子进程崩溃 | 用 try/catch 包裹 receive 调用 |

### 8.2 关键设计决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 层数编号 | 自底向上 L1-L4 | 符合自底向上构建的直觉 |
| Port interface 归属 | 放 L2 Environment | 谁消费谁定义 |
| Service interface 归属 | 放 L3 Service | 谁提供谁定义（向上暴露，非 UI 点菜）|
| Actor 引入时机 | Phase 4，非起步 | 避免架构先行太重，影响变现 |
| 去中心化 | 无中央路由器 | 每个 Agent 自行订阅、判断、处理 |
| 能量模型 | 公共池 + 私有池 | 模拟真实生物的资源获取机制 |
| 消息缓冲 | 短期保留，自动淘汰 | 类似工作记忆，长期记忆归 Agent 管理 |
| 重构方式 | 逐步迁移，不停产品 | 每个 Phase 都是可发布状态 |

---

## 9. 设计模式总览

| 模式 | 应用 | 引入阶段 |
|------|------|----------|
| **Ports & Adapters** | Port 定义能力接口，Adapter 按运行时替换 | Phase 1 |
| **Facade** | Service 包装底层机制为简单 API | Phase 1 |
| **Observer** | EventBus 发布订阅 | Phase 2 |
| **Decorator** | EncryptedStorage 叠加加密、FallbackLLM 叠加降级 | Phase 2 |
| **Strategy** | 邮箱溢出策略、Supervisor 重启策略、资源降级策略 | Phase 3-4 |
| **Actor Model** | 有界邮箱异步通信，独立生命周期 | Phase 4 |
| **Supervisor Tree** | 崩溃隔离 + 自动恢复 | Phase 4 |
| **State Machine** | Actor/Agent 生命周期状态转换 | Phase 4 |

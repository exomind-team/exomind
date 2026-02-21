# ExoMind 整合开发路线图

> **版本**: v2.0
> **创建时间**: 2026-02-03
> **最后更新**: 2026-02-03
> **状态**: 已审核
> **评审**: [ROADMAP_REVIEW.md](./ROADMAP_REVIEW.md) | [MULTIEND_REVIEW.md](./MULTIEND_REVIEW.md)

---

## 1. 概述

### 1.1 文档目的

本路线图整合以下三个项目的核心能力，提出 ExoMind 系统的分阶段开发方案，并支持多端适配（Web/Tauri/Android）。

| 项目 | 来源 | 核心能力 |
|------|------|----------|
| **Exo Agents 多代理系统** | `wzy-agents-260203/` | 多代理协作、SSE 通信、记忆系统、健康监控 |
| **ExoBuffer Connector** | `ExoBuffer-Connector/` | 事件采集、实时同步、Fact/Analysis 数据模型 |
| **语音 IME 模块** | `exomind-model/` | 云端语音识别、TTS 语音合成 |

### 1.2 整合目标

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ExoMind 整合架构                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    用户交互层                                │   │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────┐│   │
│  │  │  Web SPA  │  │Tauri Desk│  │  Android  │  │  ...  ││   │
│  │  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └───────┘│   │
│  └────────┼──────────────┼──────────────┼───────────────────────┘   │
│           │              │              │                           │
│           ▼              ▼              ▼                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    API Gateway (统一入口)                     │   │
│  └───────────────────────────┬─────────────────────────────────┘   │
│                              │                                      │
│           ┌──────────────────┼──────────────────┐                  │
│           ▼                  ▼                  ▼                  │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │
│  │   Agent Core     │ │   ExoBuffer     │ │    记忆系统      │  │
│  │   (TS 主 Agent)  │ │   (SSE 广播)    │ │  (短期+长期)     │  │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 整合原则

| 原则 | 说明 |
|------|------|
| **每日产出** | 每个阶段 1 天，必须产出可运行的成果 |
| **并行开发** | 多个任务同时推进，WorkTree 隔离 |
| **复用优先** | 优先复用现有项目的成熟代码 |
| **多端适配** | Web/Tauri/Android 同一功能多端体验一致 |

### 1.4 Agent 语言策略

> **关键决策**: 主 Agent 使用 TypeScript，子 Agent 保留 Python

| Agent 类型 | 语言 | 理由 |
|------------|------|------|
| **主 Agent** | TypeScript | 与前端架构统一，复用现有代码 |
| **子 Agent** | Python | 复用 wzy-agents 的成熟实现 |
| **通信协议** | HTTP + SSE | 跨语言通信，兼容现有架构 |

---

## 2. 每日开发计划

### 2.1 第一周：核心框架

| 日期 | 任务 | 产出 |
|------|------|------|
| **Day 1** | 项目初始化、TypeScript 配置 | 脚手架代码 |
| **Day 2** | Agent 基类、消息处理 | Agent.ts 基类 |
| **Day 3** | Claude Code 集成、流式响应解析 | Claude 客户端 |
| **Day 4** | 数据模型定义、JSONL 存储 | Fact/Analysis 接口 |
| **Day 5** | REST API (Fact CRUD) | API 服务 |
| **Day 5** | 记忆系统初始化 | 记忆目录结构 |

### 2.2 第二周：功能完善

| 日期 | 任务 | 产出 |
|------|------|------|
| **Day 6** | SSE 实时广播 | SSE 服务 |
| **Day 7** | 短期记忆模块 | short-term.md |
| **Day 8** | 长期记忆模块（9 领域） | 9 个 md 文件 |
| **Day 9** | 健康指标采集 | 指标计算模块 |
| **Day 10** | 健康报告生成 | 报告模板 |
| **Day 10** | ASR 集成 | 语音识别模块 |

### 2.3 第三周：多端开发

| 日期 | 任务 | 产出 |
|------|------|------|
| **Day 11** | TTS 集成、事件集成 | 语音合成模块 |
| **Day 12** | Web SPA 脚手架 | React 应用骨架 |
| **Day 13** | 终端页面、对话页面 | 前端页面 |
| **Day 14** | 用户认证、JWT | 认证模块 |
| **Day 15** | 响应式布局 | 适配完成 |

### 2.4 第四周：移动端与同步

| 日期 | 任务 | 产出 |
|------|------|------|
| **Day 16** | Tauri Desktop 配置 | 桌面应用 |
| **Day 17** | 系统通知、托盘 | 系统集成 |
| **Day 18** | 多端数据同步服务 | 同步模块 |
| **Day 19** | 离线存储 (IndexedDB) | 离线支持 |
| **Day 20** | PWA 支持 (Service Worker) | PWA 配置 |

### 2.5 第五周：测试与优化

| 日期 | 任务 | 产出 |
|------|------|------|
| **Day 21** | 单元测试 (100% 覆盖) | 测试用例 |
| **Day 22** | 集成测试 | 测试报告 |
| **Day 23** | E2E 测试 | 测试脚本 |
| **Day 24** | 性能优化 | 优化报告 |
| **Day 25** | 安全审计、文档完善 | 安全报告 |

---

## 4. 每日详细计划

### Day 1: 项目初始化

| 项目 | 内容 |
|------|------|
| **任务** | 初始化项目结构、TypeScript 配置 |
| **产出** | `package.json`, `tsconfig.json`, 目录结构 |

**验收标准**：
- [ ] `bun install` 成功
- [ ] TypeScript 编译通过
- [ ] 基础目录结构创建

---

### Day 2: Agent 基类

| 项目 | 内容 |
|------|------|
| **任务** | 实现 Agent 基类、消息处理 |
| **产出** | `src/core/agent.ts` |

**核心代码**：

```typescript
// src/core/agent.ts
export class Agent {
  id: string;
  state: AgentState;
  messenger: Messenger;
  memory: Memory;

  async receive(message: Message): Promise<Response> {
    // 消息处理
  }

  async think(context: Context): Promise<Action> {
    // Claude Code 调用
  }

  async act(action: Action): Promise<Result> {
    // 执行动作
  }
}
```

**验收标准**：
- [ ] Agent 类可实例化
- [ ] 消息能进入队列
- [ ] 基础测试通过

---

### Day 3: Claude 集成

| 项目 | 内容 |
|------|------|
| **任务** | Claude Code 集成、流式响应解析 |
| **产出** | `src/core/claude.ts` |

**验收标准**：
- [ ] 能调用 Claude Code
- [ ] 流式响应正确解析
- [ ] 基础测试通过

---

### Day 4: 数据模型

| 项目 | 内容 |
|------|------|
| **任务** | Fact/Analysis 数据模型、JSONL 存储 |
| **产出** | `src/models/fact.ts`, `src/models/analysis.ts` |

**核心代码**：

```typescript
// src/models/fact.ts
export interface Fact {
  fact_id: string;      // f-{uuid}
  timestamp: number;     // 毫秒级时间戳
  source: 'manual' | 'api' | 'tool';
  content_type: 'text' | 'url';
  content: string;
  meta: FactMeta;
}

export class FactStore {
  private path: string;

  append(fact: Fact): void {
    // 追加到 JSONL 文件
  }

  query(filter: Filter): Fact[] {
    // 查询
  }
}
```

**验收标准**：
- [ ] Fact 接口定义完整
- [ ] JSONL 追加成功
- [ ] 查询功能正常

---

### Day 5: REST API

| 项目 | 内容 |
|------|------|
| **任务** | REST API (Fact CRUD)、记忆系统初始化 |
| **产出** | `src/api/fact.ts`, `memory/` 目录 |

**API 端点**：

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/fact` | 创建 Fact |
| GET | `/api/facts` | 获取列表 |
| GET | `/api/fact/:id` | 获取单个 |
| GET | `/api/memory` | 获取记忆 |

**验收标准**：
- [ ] API 服务启动成功
- [ ] POST /api/fact 返回 201
- [ ] GET /api/facts 返回列表
- [ ] 记忆目录结构创建

---

### Day 6: SSE 实时广播

| 项目 | 内容 |
|------|------|
| **任务** | SSE 实时广播 |
| **产出** | `src/sse/broadcast.ts` |

**核心代码**：

```typescript
// src/sse/broadcast.ts
export class SSEBroadcaster {
  private clients: Set<EventEmitter> = new Set();

  subscribe(client: EventEmitter): void {
    this.clients.add(client);
  }

  broadcast(event: Fact): void {
    this.clients.forEach(client => {
      client.emit('new_fact', event);
    });
  }
}
```

**验收标准**：
- [ ] SSE 连接成功
- [ ] 新 Fact 广播到所有客户端
- [ ] 心跳机制正常

---

### Day 7: 短期记忆

| 项目 | 内容 |
|------|------|
| **任务** | 短期记忆模块 |
| **产出** | `src/memory/short-term.ts` |

**核心代码**：

```typescript
// src/memory/short-term.ts
export interface ShortTermMemory {
  sessionId: string;
  messages: Message[];
  context: Context;
  expiresAt: number;
}

export class ShortTermMemoryStore {
  private store: Map<string, ShortTermMemory> = new Map();

  add(sessionId: string, message: Message): void {
    // 添加到会话记忆
  }

  get(sessionId: string): Message[] {
    // 获取会话记忆
  }

  clear(sessionId: string): void {
    // 清除会话记忆
  }
}
```

**验收标准**：
- [ ] 消息能添加到短期记忆
- [ ] 会话内记忆可读取
- [ ] 会话结束记忆清除

---

### Day 8: 长期记忆

| 项目 | 内容 |
|------|------|
| **任务** | 长期记忆模块（9 领域） |
| **产出** | `memory/*.md` (9 个文件) |

**记忆结构**：

```
memory/
├── short-term.md         # 当前任务状态
├── 00-index.md           # 记忆索引
├── 01-记忆体系.md
├── 02-用户偏好.md
├── 03-技术经验.md
├── 04-边界规则.md
├── 05-模式识别.md
├── 06-健康度量.md
├── 07-外心系统.md
├── 08-成长伙伴.md
└── 09-待实现功能.md
```

**验收标准**：
- [ ] 9 个领域文件创建
- [ ] 能读取长期记忆
- [ ] 记忆索引可查询

---

### Day 9: 健康指标

| 项目 | 内容 |
|------|------|
| **任务** | 健康指标采集 |
| **产出** | `src/health/metrics.ts` |

**指标定义**：

| 轨道 | 指标 | 计算方式 | 目标值 |
|------|------|----------|--------|
| 技术健康 | 缓存命中率 | 缓存读取 / 总输入 | > 80% |
| 技术健康 | 成本/轮 | 累计成本 / 对话轮数 | 稳定 |
| 成长健康 | 目标对齐度 | 有效输出 / 总交互 | > 50% |
| 成长健康 | 记忆转化率 | 短期→长期转换率 | > 30% |

**验收标准**：
- [ ] 能计算各项指标
- [ ] 指标存储到数据库
- [ ] 基础测试通过

---

### Day 10: 健康报告

| 项目 | 内容 |
|------|------|
| **任务** | 健康报告生成、ASR 集成 |
| **产出** | `src/health/report.ts`, `src/voice/asr.ts` |

**验收标准**：
- [ ] 健康报告生成
- [ ] 报告可导出
- [ ] ASR 模块初始化

---

### Day 11: TTS 集成

| 项目 | 内容 |
|------|------|
| **任务** | TTS 集成、语音事件集成 |
| **产出** | `src/voice/tts.ts` |

**验收标准**：
- [ ] TTS 能合成语音
- [ ] 语音事件能转为 Fact
- [ ] 基础测试通过

---

### Day 12: Web SPA 脚手架

| 项目 | 内容 |
|------|------|
| **任务** | Web SPA 脚手架 |
| **产出** | `web/` 目录结构 |

**目录结构**：

```
web/
├── src/
│   ├── App.tsx
│   ├── pages/
│   │   ├── Terminal.tsx
│   │   ├── Chat.tsx
│   │   └── Settings.tsx
│   ├── components/
│   │   ├── MessageList.tsx
│   │   ├── MessageInput.tsx
│   │   └── FilterBar.tsx
│   ├── hooks/
│   │   └── useSSE.ts
│   └── lib/
│       └── api.ts
├── package.json
└── vite.config.ts
```

**验收标准**：
- [ ] React 应用启动
- [ ] Vite 开发服务器正常
- [ ] 基础路由可用

---

### Day 13: 前端页面

| 项目 | 内容 |
|------|------|
| **任务** | 终端页面、对话页面 |
| **产出** | `src/pages/Terminal.tsx`, `src/pages/Chat.tsx` |

**验收标准**：
- [ ] 终端页面可显示消息
- [ ] 对话页面可发送消息
- [ ] 消息实时更新

---

### Day 14: 用户认证

| 项目 | 内容 |
|------|------|
| **任务** | 用户认证、JWT |
| **产出** | `src/lib/auth.ts` |

**验收标准**：
- [ ] JWT 生成和验证
- [ ] 登录/登出功能
- [ ] 路由守卫可用

---

### Day 15: 响应式布局

| 项目 | 内容 |
|------|------|
| **任务** | 响应式布局 |
| **产出** | Tailwind 配置完成 |

**验收标准**：
- [ ] 桌面端布局正常
- [ ] 平板端布局正常
- [ ] 手机端布局正常

---

### Day 16: Tauri Desktop

| 项目 | 内容 |
|------|------|
| **任务** | Tauri Desktop 配置 |
| **产出** | `src-tauri/` 配置完成 |

**验收标准**：
- [ ] Tauri 应用可构建
- [ ] 窗口配置正常
- [ ] IPC 通信正常

---

### Day 17: 系统集成

| 项目 | 内容 |
|------|------|
| **任务** | 系统通知、托盘 |
| **产出** | 系统集成模块 |

**验收标准**：
- [ ] 原生通知可用
- [ ] 托盘菜单可用
- [ ] 基础测试通过

---

### Day 18: 数据同步服务

| 项目 | 内容 |
|------|------|
| **任务** | 多端数据同步服务 |
| **产出** | `src/sync/service.ts` |

**验收标准**：
- [ ] 同步服务启动
- [ ] 数据能同步到多端
- [ ] 冲突检测可用

---

### Day 19: 离线存储

| 项目 | 内容 |
|------|------|
| **任务** | 离线存储 (IndexedDB) |
| **产出** | `src/sync/offline.ts` |

**验收标准**：
- [ ] 数据能存储到 IndexedDB
- [ ] 离线时数据不丢失
- [ ] 在线时自动同步

---

### Day 20: PWA 支持

| 项目 | 内容 |
|------|------|
| **任务** | PWA 支持 (Service Worker) |
| **产出** | `public/sw.ts`, `public/manifest.json` |

**验收标准**：
- [ ] Service Worker 注册成功
- [ ] 离线页面可用
- [ ] 可安装到桌面/手机

---

### Day 21-23: 测试

| 项目 | 内容 |
|------|------|
| **任务** | 单元测试、集成测试、E2E 测试 |
| **产出** | 测试用例、测试报告 |

**测试覆盖率目标**：
- 单元测试：100%
- 集成测试：80%
- E2E：关键流程

**验收标准**：
- [ ] 单元测试 100% 通过
- [ ] 集成测试全部通过
- [ ] E2E 关键流程通过

---

### Day 24-25: 优化与发布

| 项目 | 内容 |
|------|------|
| **任务** | 性能优化、安全审计、文档完善 |
| **产出** | 优化报告、安全报告、文档 |

**验收标准**：
- [ ] 内存 < 500MB
- [ ] 响应 < 3s
- [ ] 无高危漏洞
- [ ] 文档完善

---

## 5. 里程碑时间线

### 5.1 总览

```
Day  1-5   │ Day 6-10  │ Day 11-15 │ Day 16-20 │ Day 21-25
   │         │           │            │            │
   ├─ Core  ├─ ExoBuffer├─ Voice    ├─ Mobile   ├─ Tests
   ├─ Memory├─ Health    └─ Web       └─ Sync     └─ Optimize
   └─ Models└─ API      (完成 MVP)   (完成 MVP)  (完成 MVP)
```

### 5.2 关键里程碑

| 日期 | 里程碑 | 产出 |
|------|--------|------|
| **Day 5** | MVP 核心 | Agent + API + Fact 模型 |
| **Day 10** | MVP 功能 | 记忆 + 健康 + 语音 |
| **Day 15** | MVP 前端 | Web SPA 完整可用 |
| **Day 20** | MVP 多端 | Desktop + Sync + PWA |
| **Day 25** | v1.0 RC | 测试完成、准备发布 |

---

## 6. 技术架构

### 6.1 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端框架** | React 18.3.1 | UI 展示层 |
| **前端语言** | TypeScript 5.6.2 | 类型安全 |
| **构建工具** | Vite 6.0.3 | 快速构建 |
| **UI 库** | shadcn/ui + Tailwind CSS | 现代化组件库 |
| **桌面框架** | Tauri 2.0 | 跨平台桌面应用 |
| **后端语言** | Rust 2021 | 高性能核心逻辑 |
| **Web 框架** | Axum 0.7 | API 服务 |
| **测试框架** | Vitest | 单元测试框架 |

### 6.2 目录结构

```
exomind/
├── src/                    # TypeScript 核心
│   ├── core/              # Agent 核心
│   ├── models/            # 数据模型
│   ├── api/               # REST API
│   ├── sse/               # SSE 广播
│   ├── memory/            # 记忆系统
│   ├── health/            # 健康监控
│   ├── voice/             # 语音模块
│   └── sync/              # 同步模块
├── web/                   # React 前端
│   ├── src/
│   │   ├── pages/         # 页面
│   │   ├── components/    # 组件
│   │   ├── hooks/        # 自定义 Hooks
│   │   └── lib/          # 工具函数
│   └── public/            # 静态资源
├── src-tauri/            # Tauri 后端
│   ├── src/
│   └── Cargo.toml
└── memory/                # 长期记忆
```

---

## 7. 风险与应对

### 7.1 技术风险

| 风险 | 影响 | 应对策略 |
|------|------|----------|
| Claude Code API 变更 | 高 | 抽象接口，隔离依赖 |
| Python→TS 迁移 | 高 | 渐进式迁移，保留 Python 子 Agent |
| 语音 API 延迟 | 中 | 本地缓存 + 流式处理 |
| SSE 连接不稳定 | 中 | 指数退避重连 |
| 多端数据一致 | 高 | 统一数据源，事件溯源 |

### 7.2 进度风险

| 风险 | 影响 | 应对策略 |
|------|------|----------|
| 每日产出不达标 | 高 | 及时调整计划 |
| 分支冲突频繁 | 中 | 每日合并，提前沟通 |
| 测试覆盖不足 | 中 | TDD 驱动，100% 覆盖 |

---

## 8. 参考文档

| 文档 | 路径 |
|------|------|
| Exo Agents 分析报告 | `../wzy-agents-260203/PROJECT_ANALYSIS_REPORT.md` |
| ExoBuffer 需求报告 | `../ExoBuffer-Connector/REQUIREMENTS_REPORT.md` |
| 路线图评审 | `./ROADMAP_REVIEW.md` |
| 多端适配评审 | `./MULTIEND_REVIEW.md` |
| ExoMind 知识库 | `../docs/ExoMind-KNOWLEDGE-BASE.md` |
| 产品路线图 | `../pm/roadmap.md` |
| 任务计划 | `../pm/tasks_plan.md` |

---

*创建时间: 2026-02-03*
*版本: 2.0*
*状态: 已审核*

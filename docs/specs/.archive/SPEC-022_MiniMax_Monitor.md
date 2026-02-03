# SPEC-022: MiniMax 多账户资源监控功能

> 需求规格文档
> 版本：v1.1
> 创建日期：2026-01-29
> 更新日期：2026-01-29
> 状态：待评审

> **关联文档**:
> - [7 层架构文档](./ARCHITECTURE_7LAYER.md)
> - [产品路线图](../pm/roadmap.md)
> - [PRD](../pm/PRD.md)

---

## 目录

1. [概述](#1-概述)
2. [用户故事](#2-用户故事)
3. [架构设计](#3-架构设计)
4. [Resource Fetcher 模块](#4-resource-fetcher-模块)
5. [数据流图](#5-数据流图)
6. [时序图](#6-时序图)
7. [ER 图](#7-er-图)
8. [文件结构](#8-文件结构)
9. [接口设计](#9-接口设计)
10. [数据结构](#10-数据结构)
11. [实现原则](#11-实现原则)
12. [实现优先级](#12-实现优先级)
13. [UI 设计](#13-ui-设计)
14. [自动化测试](#14-自动化测试)
15. [验收标准](#15-验收标准)

---

## 1. 概述

### 1.1 功能概述

| 项目 | 说明 |
|------|------|
| **功能名称** | MiniMax 多账户资源监控 |
| **模块** | exomind-core / resource |
| **目标** | 集成真实 MiniMax API 额度获取，显示在前端，提供对外查询 API |
| **核心创新** | 信号池架构隔离"获取"和"查询"，存储层抽象支持 SQLite |

### 1.2 背景与动机

```
┌─────────────────────────────────────────────────────────────────────┐
│                     资源监控 - 认知生命的第一步                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  **核心洞察**：                                                     │
│  感知和学习不是后加功能，而是从单细胞阶段就作为存活优势存在            │
│                                                                     │
│  **能源感知意义**：                                                 │
│  1. Agent 必须感知真实能源，才能决定消耗多少资源执行下一步             │
│  2. 能量 = MiniMax API 真实消耗，Agent 为自己的 token usage 负责     │
│  3. 能量耗尽时自动休眠，有能量时恢复运行                              │
│  4. 这是实现"自主生命体"的基础能力                                   │
│                                                                     │
│  **参考**：                                                         │
│  - roadmap.md: "能量是生命持续的物理前提，不是价值函数"               │
│  - PRD.md: "能量池配置" + "能量消耗规则"                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 术语定义

| 术语 | 定义 |
|------|------|
| **信号池 (Signal Pool)** | L5 层核心组件，隔离数据获取和数据查询 |
| **Actor** | L4 层数据持有者（当前阶段暂移除，状态由 Agent 直接持有） |
| **Storage** | L2 层存储抽象，提供统一接口 |
| **Resource Fetcher** | L6 层通用资源获取模块，支持多种数据源 |
| **TTL** | Time To Live，缓存过期时间 |

---

## 2. 用户故事

### 2.1 核心用户故事

```
┌─────────────────────────────────────────────────────────────────────┐
│                     核心用户故事                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  故事 1：作为 自主 Agent                                             │
│  我希望 实时感知我的能源余额（MiniMax API 额度）                       │
│  以便 我能根据剩余能量决定下一步的行动策略                             │
│  验收标准：                                                          │
│  - [ ] 每 5 分钟自动获取一次真实额度                                  │
│  - [ ] 能量低于 20% 时进入节能模式                                    │
│  - [ ] 能量为 0 时自动休眠                                           │
│  - [ ] 可查看历史使用记录                                             │
│                                                                     │
│  ────────────────────────────────────────────────────────────────  │
│                                                                     │
│  故事 2：作为 用户                                                   │
│  我希望 在网页上查看各 MiniMax 账户的真实使用额度                      │
│  以便 了解剩余资源，合理规划使用                                      │
│  验收标准：                                                          │
│  - [ ] 可以看到每个账户的已用/剩余/总额度                              │
│  - [ ] 进度条显示使用百分比                                           │
│  - [ ] 可以手动刷新数据                                              │
│  - [ ] 数据有缓存，响应快速                                           │
│                                                                     │
│  ────────────────────────────────────────────────────────────────  │
│                                                                     │
│  故事 3：作为 开发者                                                 │
│  我希望 提供一个 API 让他人查询额度                                   │
│  以便 集成到其他系统或让其他 Agent 感知我的能源状态                    │
│  验收标准：                                                          │
│  - [ ] 提供 RESTful API                                              │
│  - [ ] 支持单个账户查询和全部账户汇总                                  │
│  - [ ] 支持查询历史记录                                               │
│  - [ ] API 响应格式统一                                               │
│                                                                     │
│  ────────────────────────────────────────────────────────────────  │
│                                                                     │
│  故事 4：作为 系统管理员                                              │
│  我希望 管理多个 MiniMax 账户的配置                                   │
│  以便 灵活添加/禁用/切换账户                                          │
│  验收标准：                                                          │
│  - [ ] 可以添加新账户（配置 Cookie 路径）                              │
│  - [ ] 可以禁用/启用账户                                              │
│  - [ ] 可以设置账户优先级                                             │
│  - [ ] 配置持久化存储                                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 详细需求（修正编号）

| 编号 | 需求 | 优先级 | 说明 |
|------|------|--------|------|
| R01 | 多账户额度显示 | P0 | 支持 default/agent1/agent2 |
| R02 | 真实 API 数据 | P0 | 从 MiniMax API 获取真实数据 |
| R03 | 缓存机制 | P1 | 5 分钟 TTL，减少 API 调用 |
| R04 | 对外查询 API | P1 | 提供 RESTful API |
| R05 | 账户配置页面 | P1 | 启用/禁用账户 |
| R06 | 历史记录 | P2 | 持久化存储历史数据 |
| R07 | 手动刷新 | P2 | 用户可手动触发刷新 |
| R08 | 能源感知 | P0 | Agent 能感知真实能源用于决策 |
| R09 | 状态机联动 | P1 | 与能量状态机（ACTIVE/ECO/STANDBY/SLEEP）联动 |

---

## 3. 架构设计

> **参考文档**: [7 层架构文档](./ARCHITECTURE_7LAYER.md)

### 3.1 7 层架构图（简化版）

```
┌─────────────────────────────────────────────────────────────────────┐
│                     7 层架构 - MiniMax 功能位置                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  L7-UI (前端展示层)                                                  │
│  ├── 资源监控页 - 显示额度卡片                                        │
│  └── 设置页 - 账户配置管理                                           │
│         │                                                           │
│         ▼  HTTP 请求                                                │
│  L6-Agent (业务逻辑层)                                               │
│  ├── Resource Fetcher ⭐ 通用资源获取模块                             │
│  │   ├── PlaywrightFetcher - 浏览器自动化获取                        │
│  │   ├── HttpFetcher - HTTP 请求获取                                 │
│  │   └── ApiFetcher - API 调用获取                                   │
│  ├── MinimaxAgent - 多账户获取逻辑                                    │
│  ├── AccountConfigManager - 账户配置管理                             │
│  └── HistoryRecorder - 历史记录生成                                   │
│         │                                                           │
│         ▼  信号                                                     │
│  L5-Signals (信号池层) ⭐ 核心创新                                    │
│  ├── RefreshSignal - 刷新信号（触发获取）                             │
│  ├── UsageSignal - 额度信号（缓存结果）                               │
│  └── HistorySignal - 历史记录信号                                    │
│         │                                                           │
│         ▼  信号处理                                                  │
│  L4-Actor (数据持有层) ⭐ 当前阶段暂移除                               │
│  └── （状态直接由 L6-Agent 持有，后续按需添加）                        │
│         │                                                           │
│         ▼  存储接口调用                                               │
│  L3-Sync (同步层) ⭐ 暂不需要                                         │
│  └── （单 Actor 场景不需要）                                          │
│         │                                                           │
│         ▼  统一接口                                                  │
│  L2-Storage (存储抽象层) ⭐ 核心抽象                                   │
│  ├── 接口定义：save / load / append / query                          │
│  └── 实现：SQLite（当前唯一实现）                                     │
│         │                                                           │
│         ▼  文件操作                                                  │
│  L1-Network (网络层)                                                 │
│  ├── HTTP Server + Router                                           │
│  ├── WebSocket（未来）                                               │
│  └── P2P/IPFS（可选扩展）                                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 模块依赖关系

```
src/
├── minimax/                    ⭐ 业务模块
│   ├── client.ts              # MiniMax API 调用
│   ├── types.ts               # 类型定义
│   └── accounts.ts            # 账户管理
│
└── core/
    ├── l1-network/            # 网络层
    │   ├── server.ts
    │   ├── router.ts
    │   └── handlers/
    │       └── minimax-handler.ts
    │
    ├── l2-storage/            # 存储层 ⭐
    │   ├── index.ts           # 工厂函数
    │   ├── types.ts           # Storage 接口
    │   └── sqlite-storage.ts  # SQLite 实现
    │
    ├── l3-sync/               # 同步层（暂不需要）
    │   └── index.ts
    │
    ├── l4-actor/              # Actor 层（暂移除）
    │   └── index.ts
    │
    ├── l5-signals/            # 信号池层 ⭐
    │   ├── index.ts
    │   ├── signal-pool.ts
    │   ├── types.ts
    │   └── minimax-handler.ts
    │
    └── l6-agent/              # Agent 层
        ├── index.ts
        ├── minimax-agent.ts
        └── resource-fetcher/  # ⭐ 通用资源获取模块
            ├── index.ts
            ├── types.ts
            └── fetchers/
                ├── index.ts
                ├── playwright-fetcher.ts
                ├── http-fetcher.ts
                └── api-fetcher.ts
```

### 3.3 设计原则

| 原则 | 说明 | 应用层级 |
|------|------|----------|
| **存储抽象** | 上层只调用统一接口，不关心底层实现 | L2-Storage |
| **信号隔离** | 获取和查询分离，信号池作为缓冲区 | L5-Signals |
| **资源获取通用化** | 统一接口支持多种数据源获取 | L6-Agent (Resource Fetcher) |
| **单一职责** | 每个模块只做一件事 | 全部 |
| **依赖倒置** | 上层依赖接口，不依赖具体实现 | L2-L6 |
| **简化优先** | L4-Actor/L3-Sync 暂移除，按需添加 | L3/L4 |

---

## 4. Resource Fetcher 模块

> **核心设计**：通用资源获取模块，支持多种数据源获取

### 4.1 模块定位

```
┌─────────────────────────────────────────────────────────────────────┐
│                  Resource Fetcher - 定位                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  问题背景:                                                          │
│  · MiniMax 额度获取 - Playwright + Cookie                           │
│  · 微信文章获取 - 爬虫 + 解析                                        │
│  · 文件下载 - HTTP 下载                                             │
│  · API 调用 - REST/GraphQL                                          │
│                                                                     │
│  共同点:                                                            │
│  · 都是"从外部获取数据"                                             │
│  · 都需要认证/Cookie                                                │
│  · 都需要错误处理和重试                                             │
│  · 都需要结果解析                                                   │
│                                                                     │
│  解决方案:                                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Resource Fetcher - 通用资源获取器                            │   │
│  │  ┌─────────────────────────────────────────────────────────┐ │   │
│  │  │  Fetcher Interface - 统一接口                           │ │   │
│  │  ├─────────────────────────────────────────────────────────┤ │   │
│  │  │  实现:                                                  │ │   │
│  │  │  · PlaywrightFetcher - 浏览器自动化获取                 │ │   │
│  │  │  · HttpFetcher - HTTP 请求获取                          │ │   │
│  │  │  · ApiFetcher - API 调用获取                            │ │   │
│  │  └─────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 核心接口

```typescript
// src/core/l6-agent/resource-fetcher/types.ts

/**
 * 资源获取器接口
 */
export interface ResourceFetcher {
  /** 获取器名称 */
  name: string;

  /** 支持的协议 */
  protocols: string[];

  /** 获取资源 */
  fetch(input: FetchInput): Promise<FetchOutput>;

  /** 验证输入 */
  validate(input: FetchInput): ValidationResult;

  /** 解析结果 */
  parse(raw: unknown): ParsedResource;
}

/**
 * 获取输入
 */
export interface FetchInput {
  /** 资源标识 */
  url: string;

  /** 获取器类型 */
  type: string;

  /** 认证配置 */
  auth?: AuthConfig;

  /** 选项 */
  options?: FetchOptions;
}

/**
 * 获取输出
 */
export interface FetchOutput {
  /** 原始数据 */
  raw: unknown;

  /** 解析后数据 */
  parsed: ParsedResource;

  /** 元数据 */
  metadata: {
    fetchedAt: Date;
    duration: number;
    size: number;
    contentType: string;
  };
}

/**
 * 解析后的资源
 */
export interface ParsedResource {
  /** 资源类型 */
  type: 'text' | 'html' | 'json' | 'image' | 'video' | 'custom';

  /** 内容 */
  content: unknown;

  /** 结构化数据 */
  data?: Record<string, unknown>;

  /** 错误信息 */
  error?: string;
}

/**
 * 认证配置
 */
export interface AuthConfig {
  /** 认证类型 */
  type: 'cookie' | 'bearer' | 'basic' | 'apikey' | 'none';

  /** 凭证 */
  credentials: Record<string, string>;

  /** Cookie 路径（Playwright） */
  cookiePath?: string;
}

/**
 * 获取选项
 */
export interface FetchOptions {
  /** 超时时间 */
  timeout?: number;

  /** 重试次数 */
  retries?: number;

  /** 重试间隔 */
  retryDelay?: number;

  /** 请求头 */
  headers?: Record<string, string>;

  /** 代理 */
  proxy?: string;

  /** 解析器选择 */
  parser?: string;
}

/**
 * 验证结果
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}
```

### 4.3 Playwright Fetcher 实现

```typescript
// src/core/l6-agent/resource-fetcher/fetchers/playwright-fetcher.ts

import type { ResourceFetcher, FetchInput, FetchOutput, ParsedResource, ValidationResult, AuthConfig } from '../types.js';

export class PlaywrightFetcher implements ResourceFetcher {
  name = 'playwright';
  protocols = ['http', 'https'];

  constructor(private browser: Browser) {}

  async fetch(input: FetchInput): Promise<FetchOutput> {
    const startTime = Date.now();

    // 1. 加载 Cookie（如果是 Playwright Profile）
    const context = await this.browser.newContext({
      storageState: input.auth?.cookiePath,
    });

    // 2. 访问页面
    const page = await context.newPage();
    await page.goto(input.url, { waitUntil: 'networkidle' });

    // 3. 解析内容
    const content = await page.content();
    const parsed = this.parse({ content, url: input.url });

    await context.close();

    return {
      raw: content,
      parsed,
      metadata: {
        fetchedAt: new Date(),
        duration: Date.now() - startTime,
        size: content.length,
        contentType: 'text/html',
      },
    };
  }

  validate(input: FetchInput): ValidationResult {
    const errors: string[] = [];

    if (!input.url) {
      errors.push('URL is required');
    }

    if (!input.url.startsWith('http')) {
      errors.push('URL must start with http:// or https://');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  parse(raw: unknown): ParsedResource {
    const data = raw as { content: string; url: string };

    // MiniMax 特定解析
    if (data.url.includes('minimaxi.com')) {
      return {
        type: 'custom',
        content: data.content,
        data: this.parseMiniMax(data.content),
      };
    }

    return {
      type: 'html',
      content: data.content,
    };
  }

  private parseMiniMax(html: string): Record<string, unknown> {
    // MiniMax 使用量解析逻辑
    // 从 HTML 中提取 used, remaining, total
    // ...
    return { used: 0, remaining: 0, total: 0 };
  }
}
```

### 4.4 Fetcher 工厂

```typescript
// src/core/l6-agent/resource-fetcher/index.ts

import type { ResourceFetcher, FetchInput } from './types.js';
import { PlaywrightFetcher } from './fetchers/playwright-fetcher.js';
import { HttpFetcher } from './fetchers/http-fetcher.js';
import { ApiFetcher } from './fetchers/api-fetcher.js';

export class FetcherFactory {
  private fetchers: Map<string, ResourceFetcher> = new Map();

  constructor() {
    // 注册默认 Fetcher
    this.register('playwright', new PlaywrightFetcher(browser));
    this.register('http', new HttpFetcher());
    this.register('api', new ApiFetcher());
  }

  register(name: string, fetcher: ResourceFetcher): void {
    this.fetchers.set(name, fetcher);
  }

  get(type: string): ResourceFetcher | undefined {
    return this.fetchers.get(type);
  }

  async fetch(input: FetchInput): Promise<FetchOutput> {
    const fetcher = this.get(input.type);
    if (!fetcher) {
      throw new Error(`Unknown fetcher type: ${input.type}`);
    }

    // 验证输入
    const validation = fetcher.validate(input);
    if (!validation.valid) {
      throw new Error(`Invalid input: ${validation.errors?.join(', ')}`);
    }

    return fetcher.fetch(input);
  }
}

export const fetcherFactory = new FetcherFactory();
```

---

## 5. 数据流图

### 5.1 读操作数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│                    数据流 - 读操作（查询额度）                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   前端                    后端                                        │
│     │                       │                                        │
│     │  GET /api/resource/   │                                        │
│     │  minimax?account=xxx  │                                        │
│     │──────────────────────→│                                        │
│     │                       │                                        │
│     │                       │ 1. 路由到 MinimaxHandler               │
│     │                       │───────────────────────────────────────│
│     │                       │                                        │
│     │                       │ 2. 检查信号池缓存                       │
│     │                       │───────────────────────────────────────│
│     │                       │   SignalPool.get('usage:default')      │
│     │                       │                                        │
│     │                       │ 3. 缓存命中？                          │
│     │                       │───────────────────────────────────────│
│     │                       │                                        │
│     │          ┌────────────┴────────────┐                          │
│     │          │                         │                          │
│     │          ▼                         ▼                          │
│     │   返回缓存数据              查询 Storage                        │
│     │   + 标记 cached           (load from SQLite)                   │
│     │          │                         │                          │
│     │          │                         ▼                          │
│     │          │                 4. 从 SQLite 读取                   │
│     │          │                 minimax_cache 表                    │
│     │          │                         │                          │
│     │          │                         ▼                          │
│     │          │                 5. 返回数据 + 更新缓存              │
│     │          │                         │                          │
│     │          └────────────┬────────────┘                          │
│     │                       │                                        │
│     │                       ▼                                        │
│     │               返回 {data, cached}                              │
│     │──────────────────────→│                                        │
│     │                       │                                        │
│     ▼                       ▼                                        │
│   更新页面显示              结束                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 写操作数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│                    数据流 - 写操作（刷新额度）                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   前端                    后端                                        │
│     │                       │                                        │
│     │  POST /api/resource/  │                                        │
│     │  minimax/refresh      │                                        │
│     │──────────────────────→│                                        │
│     │                       │                                        │
│     │                       │ 1. 路由到 MinimaxHandler               │
│     │                       │───────────────────────────────────────│
│     │                       │                                        │
│     │                       │ 2. 发出 RefreshSignal                  │
│     │                       │───────────────────────────────────────│
│     │                       │   SignalPool.emit('refresh', {        │
│     │                       │     account: 'default',               │
│     │                       │     force: true                       │
│     │                       │   })                                  │
│     │                       │                                        │
│     │                       │ 3. MinimaxHandler 处理信号             │
│     │                       │───────────────────────────────────────│
│     │                       │                                        │
│     │                       │ 4. 调用 MinimaxAgent.fetch()           │
│     │                       │───────────────────────────────────────│
│     │                       │                                        │
│     │                       │ 5. MinimaxAgent 调用 MiniMaxClient     │
│     │                       │───────────────────────────────────────│
│     │                       │                                        │
│     │                       │ 6. MiniMaxClient Playwright 获取数据   │
│     │                       │───────────────────────────────────────│
│     │                       │   步骤：                               │
│     │                       │   - 加载 Playwright Profile            │
│     │                       │   - 访问 MiniMax 控制台                │
│     │                       │   - 解析使用量数据                     │
│     │                       │                                        │
│     │                       │ 7. 返回 usage 数据                     │
│     │                       │───────────────────────────────────────│
│     │                       │                                        │
│     │                       │ 8. MinimaxActor 保存缓存               │
│     │                       │───────────────────────────────────────│
│     │                       │   Storage.save(`cache:${account}`,     │
│     │                       │     { data, cachedAt })                │
│     │                       │   → SQLite: minimax_cache              │
│     │                       │                                        │
│     │                       │ 9. 追加历史记录                        │
│     │                       │───────────────────────────────────────│
│     │                       │   Storage.append('history', entry)     │
│     │                       │   → SQLite: minimax_history            │
│     │                       │                                        │
│     │                       │ 10. 发出 UsageSignal                   │
│     │                       │───────────────────────────────────────│
│     │                       │   SignalPool.emit('usage', data)       │
│     │                       │                                        │
│     │                       │ 11. 返回结果给前端                     │
│     │                       │───────────────────────────────────────│
│     │                       │                                        │
│     │   返回 { success,     │                                        │
│     │     data: {...} }     │                                        │
│     │←──────────────────────│                                        │
│     │                       │                                        │
│     ▼                       ▼                                        │
│   更新页面显示              结束                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.3 配置操作数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│                    数据流 - 配置操作（账户管理）                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   前端                    后端                                        │
│     │                       │                                        │
│     │  GET /api/settings/   │                                        │
│     │  minimax/accounts     │                                        │
│     │──────────────────────→│                                        │
│     │                       │                                        │
│     │                       │ 1. MinimaxActor.loadAccounts()         │
│     │                       │───────────────────────────────────────│
│     │                       │   Storage.load('accounts')             │
│     │                       │   → SQLite: minimax_accounts           │
│     │                       │                                        │
│     │   返回 accounts 列表  │                                        │
│     │←──────────────────────│                                        │
│     │                       │                                        │
│     │  POST /api/settings/  │                                        │
│     │  minimax/accounts     │                                        │
│     │  { action: 'update',  │                                        │
│     │    account: {...} }   │                                        │
│     │──────────────────────→│                                        │
│     │                       │                                        │
│     │                       │ 2. 更新账户                            │
│     │                       │───────────────────────────────────────│
│     │                       │   MinimaxActor.saveAccounts()          │
│     │                       │   → Storage.save('accounts', accounts) │
│     │                       │                                        │
│     │   返回 { success }    │                                        │
│     │←──────────────────────│                                        │
│     │                       │                                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. 时序图

### 6.1 刷新额度时序图

```
┌─────────────────────────────────────────────────────────────────────┐
│                时序图 - 刷新额度（完整流程）                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  User    L7-UI    L1      L5-Signals  L6-Agent  L4-Actor  L2-Storage│
│   │       │       │          │           │          │          │    │
│   │       │       │          │           │          │          │    │
│   │  点击刷新     │          │           │          │          │    │
│   │──────→│       │          │           │          │          │    │
│   │       │       │          │           │          │          │    │
│   │       │ POST  │          │           │          │          │    │
│   │       │/refresh│          │           │          │          │    │
│   │       │──────→│          │           │          │          │    │
│   │       │       │          │           │          │          │    │
│   │       │       │ 路由      │           │          │          │    │
│   │       │       │──────────→│           │          │          │    │
│   │       │       │          │           │          │          │    │
│   │       │       │          │ emit      │          │          │    │
│   │       │       │          │Refresh    │          │          │    │
│   │       │       │          │──────────→│          │          │    │
│   │       │       │          │           │          │          │    │
│   │       │       │          │           │ handle() │          │    │
│   │       │       │          │           │─────────→│          │    │
│   │       │       │          │           │          │          │    │
│   │       │       │          │           │          │ fetch()  │    │
│   │       │       │          │           │          │──────────┤    │
│   │       │       │          │           │          │          │    │
│   │       │       │          │           │          │ HTTP请求 │    │
│   │       │       │          │           │          │──────────┼──→│MiniMax│
│   │       │       │          │           │          │          │    │  API  │
│   │       │       │          │           │          │←─────────┼───│      │
│   │       │       │          │           │          │          │    │
│   │       │       │          │           │          │ 返回数据 │    │
│   │       │       │          │           │          │←─────────│    │
│   │       │       │          │           │          │          │    │
│   │       │       │          │           │          │saveCache │    │
│   │       │       │          │           │          │──────────│    │
│   │       │       │          │           │          │          │    │
│   │       │       │          │           │          │save→SQLite    │
│   │       │       │          │           │          │──────────│    │
│   │       │       │          │           │          │          │    │
│   │       │       │          │           │          │appendHist│    │
│   │       │       │          │           │          │──────────│    │
│   │       │       │          │           │          │          │    │
│   │       │       │          │           │          │append→SQLite   │
│   │       │       │          │           │          │──────────│    │
│   │       │       │          │           │          │          │    │
│   │       │       │          │           │  return  │          │    │
│   │       │       │          │           │←─────────│          │    │
│   │       │       │          │           │          │          │    │
│   │       │       │          │ emit      │          │          │    │
│   │       │       │          │Usage      │          │          │    │
│   │       │       │          │───────────│          │          │    │
│   │       │       │          │           │          │          │    │
│   │       │       │  return  │           │          │          │    │
│   │       │←──────│──────────│           │          │          │    │
│   │       │       │          │           │          │          │    │
│   │←──────│       │          │           │          │          │    │
│   │       │       │          │           │          │          │    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 查询额度时序图

```
┌─────────────────────────────────────────────────────────────────────┐
│                时序图 - 查询额度（带缓存）                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  User    L7-UI    L1      L5-Signals  L4-Actor   L2-Storage         │
│   │       │       │          │           │          │               │
│   │       │       │          │           │          │               │
│   │  查看额度     │          │           │          │               │
│   │──────→│       │          │           │          │               │
│   │       │       │          │           │          │               │
│   │       │ GET   │          │           │          │               │
│   │       │/minimax?         │           │          │               │
│   │       │account=│          │           │          │               │
│   │       │──────→│          │           │          │               │
│   │       │       │          │           │          │               │
│   │       │       │ 路由      │           │          │               │
│   │       │       │──────────→│           │          │               │
│   │       │       │          │           │          │               │
│   │       │       │          │ get       │          │               │
│   │       │       │          │cache      │          │               │
│   │       │       │          │──────────→│          │               │
│   │       │       │          │           │          │               │
│   │       │       │          │           │loadCache │               │
│   │       │       │          │           │──────────┤               │
│   │       │       │          │           │          │               │
│   │       │       │          │           │          │SQLite load   │
│   │       │       │          │           │          │─────────────→│
│   │       │       │          │           │          │               │
│   │       │       │          │           │  return  │               │
│   │       │       │          │           │←─────────│               │
│   │       │       │          │           │          │               │
│   │       │       │          │ 缓存命中   │          │               │
│   │       │       │          │───────────│          │               │
│   │       │       │          │           │          │               │
│   │       │       │  return  │           │          │               │
│   │       │←──────│──────────│           │          │               │
│   │       │       │          │           │          │               │
│   │←──────│       │          │           │          │               │
│   │       │       │          │           │          │               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. ER 图

### 7.1 核心实体

```
┌─────────────────────────────────────────────────────────────────────┐
│                          ER 图 - 核心实体                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐          ┌─────────────────┐                   │
│  │   Account       │          │     Cache       │                   │
│  ├─────────────────┤          ├─────────────────┤                   │
│  │ id: TEXT (PK)   │          │ id: TEXT (PK)   │                   │
│  │ name: TEXT      │          │ data: TEXT      │                   │
│  │ displayName:    │          │ updated_at:     │                   │
│  │   TEXT          │          │   DATETIME      │                   │
│  │ cookiePath:     │          └────────┬────────┘                   │
│  │   TEXT          │                   │                            │
│  │ enabled:        │ 1          N      │                            │
│  │   BOOLEAN       │──────────┬────────┘                            │
│  │ priority:       │          │                                     │
│  │   INTEGER       │          │                                     │
│  │ created_at:     │          │                                     │
│  │   DATETIME      │          │                                     │
│  └─────────────────┘          │                                     │
│         │                     │                                     │
│         │                     │                                     │
│         │ N                   │ N                                   │
│         │                     │                                     │
│  ┌──────┴──────┐              │                                     │
│  │             │              │                                     │
│  ▼             ▼              ▼                                     │
│  ┌─────────────────┐   ┌─────────────────┐                          │
│  │    History      │   │    Settings     │                          │
│  ├─────────────────┤   ├─────────────────┤                          │
│  │ id: TEXT        │   │ key: TEXT (PK)  │                          │
│  │ account_id:     │   │ value: TEXT     │                          │
│  │   TEXT (FK)     │   │ updated_at:     │                          │
│  │ data: TEXT      │   │   DATETIME      │                          │
│  │ timestamp:      │   └─────────────────┘                          │
│  │   DATETIME      │                                                 │
│  └─────────────────┘                                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.2 数据库表结构

```sql
-- MiniMax 资源监控数据库 schema

-- 账户配置表
CREATE TABLE minimax_accounts (
    id TEXT PRIMARY KEY,           -- 账户标识 (default, agent1, agent2)
    name TEXT NOT NULL,            -- 账户名称
    display_name TEXT NOT NULL,    -- 显示名称
    cookie_path TEXT,              -- Playwright Profile 路径
    cookie_json_path TEXT,         -- Cookie JSON 文件路径
    enabled INTEGER DEFAULT 1,     -- 是否启用
    priority INTEGER DEFAULT 0,    -- 优先级
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 缓存表（每次刷新覆盖）
CREATE TABLE minimax_cache (
    id TEXT PRIMARY KEY,           -- 缓存 ID (default, agent1, agent2)
    data TEXT NOT NULL,            -- JSON 存储 usage 数据
    cached_at DATETIME NOT NULL,   -- 缓存时间
    expires_at DATETIME NOT NULL,  -- 过期时间
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 历史记录表（追加写入）
CREATE TABLE minimax_history (
    id TEXT NOT NULL,              -- 账户 ID
    data TEXT NOT NULL,            -- JSON 存储单条记录
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 全局设置表
CREATE TABLE minimax_settings (
    key TEXT PRIMARY KEY,          -- 设置键
    value TEXT NOT NULL,           -- 设置值 (JSON)
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX idx_history_timestamp ON minimax_history(timestamp);
CREATE INDEX idx_history_account ON minimax_history(id);
CREATE INDEX idx_cache_expires ON minimax_cache(expires_at);
CREATE INDEX idx_accounts_priority ON minimax_accounts(priority DESC);
```

### 7.3 数据关系

| 表名 | 主键 | 外键 | 说明 |
|------|------|------|------|
| minimax_accounts | id | - | 账户配置 |
| minimax_cache | id | - | 缓存数据 |
| minimax_history | (id, timestamp) | id → minimax_accounts.id | 历史记录 |
| minimax_settings | key | - | 全局设置 |

---

## 7. 文件结构

```
exomind/
├── src/
│   ├── core/
│   │   ├── l1-network/
│   │   │   ├── index.ts              # 网络层入口
│   │   │   ├── server.ts             # HTTP 服务器
│   │   │   ├── router.ts             # 路由定义
│   │   │   ├── types.ts              # 请求/响应类型
│   │   │   └── handlers/
│   │   │       ├── index.ts          # Handler 工厂
│   │   │       ├── minimax-handler.ts # MiniMax API Handler
│   │   │       └── resource-handler.ts # 资源通用 Handler
│   │   │
│   │   ├── l2-storage/
│   │   │   ├── index.ts              # 存储层入口 + 工厂
│   │   │   ├── types.ts              # Storage 接口定义
│   │   │   └── sqlite-storage.ts     # SQLite 实现
│   │   │
│   │   ├── l3-sync/
│   │   │   ├── index.ts              # 同步层入口
│   │   │   └── cache-sync.ts         # 缓存同步
│   │   │
│   │   ├── l4-actor/
│   │   │   ├── index.ts              # Actor 层入口
│   │   │   ├── types.ts              # Actor 类型
│   │   │   └── minimax-actor.ts      # MiniMax Actor
│   │   │
│   │   ├── l5-signals/
│   │   │   ├── index.ts              # 信号池入口
│   │   │   ├── types.ts              # 信号类型定义
│   │   │   ├── signal-pool.ts        # 信号池核心
│   │   │   └── handlers/
│   │   │       ├── index.ts          # Handler 入口
│   │   │       └── minimax-handler.ts # MiniMax 信号处理器
│   │   │
│   │   └── l6-agent/
│   │       ├── index.ts              # Agent 层入口
│   │       ├── types.ts              # Agent 类型
│   │       └── minimax-agent.ts      # MiniMax 获取逻辑
│   │
│   ├── minimax/                       # MiniMax 业务模块
│   │   ├── index.ts                  # 模块入口
│   │   ├── types.ts                  # 业务类型定义
│   │   ├── client.ts                 # MiniMax API Client
│   │   ├── accounts.ts               # 账户配置管理
│   │   ├── cookie-manager.ts         # Cookie 管理
│   │   └── parser.ts                 # 使用量解析
│   │
│   └── ui/
│       ├── src/
│       │   ├── components/
│       │   │   └── ResourceCard.tsx   # 资源卡片组件
│       │   ├── pages/
│       │   │   ├── ResourcePage.tsx   # 资源监控页面
│       │   │   └── SettingsPage.tsx   # 设置页面
│       │   ├── hooks/
│       │   │   ├── useMinimax.ts      # MiniMax 数据 Hook
│       │   │   └── useAccounts.ts     # 账户配置 Hook
│       │   └── api/
│       │       ├── index.ts           # API 客户端
│       │       └── minimax.ts         # MiniMax API
│       │
│   ├── data/
│   │   └── minimax.db                # SQLite 数据库文件
│   │
│   └── deploy/
│       └── exomind.service           # systemd 服务配置
│
├── docs/
│   └── specs/
│       └── SPEC-022_MiniMax_Monitor.md # 本规格文档
│
├── tests/
│   ├── unit/
│   │   ├── storage.test.ts           # 存储层测试
│   │   ├── actor.test.ts             # Actor 测试
│   │   ├── signals.test.ts           # 信号池测试
│   │   └── api.test.ts               # API 测试
│   ├── integration/
│   │   └── minimax.test.ts           # 集成测试
│   └── e2e/
│       └── resource-page.test.ts     # E2E 测试
│
├── package.json
└── bun.lockb
```

---

## 8. 接口设计

### 8.1 API 端点总览

| 端点 | 方法 | 功能 | 信号池 |
|------|------|------|--------|
| `/api/resource/minimax` | GET | 查询额度 | 读缓存 |
| `/api/resource/minimax/all` | GET | 查询所有账户 | 读缓存 |
| `/api/resource/minimax/refresh` | POST | 刷新额度 | 写信号 |
| `/api/resource/minimax/refresh/all` | POST | 刷新所有账户 | 写信号 |
| `/api/resource/minimax/history` | GET | 查询历史 | 读数据库 |
| `/api/settings/minimax/accounts` | GET | 获取账户配置 | 读数据库 |
| `/api/settings/minimax/accounts` | POST | 更新账户配置 | 写数据库 |
| `/api/settings/minimax/accounts/{id}/toggle` | POST | 切换账户启用状态 | 写数据库 |
| `/api/health` | GET | 健康检查 | - |

### 8.2 详细接口定义

#### 8.2.1 查询单个账户额度

```
GET /api/resource/minimax?account={account}
```

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| account | string | 否 | 账户名，默认 default |

**请求头**：

```
Content-Type: application/json
Authorization: Bearer {token}  # 可选
```

**响应示例** (200 OK):

```json
{
  "success": true,
  "data": {
    "account": "default",
    "displayName": "默认账户",
    "model": "MiniMax-M2.1",
    "total": 1000000,
    "used": 750000,
    "remaining": 250000,
    "percentage": 75.0,
    "cached": true,
    "cachedAt": "2026-01-29T19:00:00Z",
    "expiresAt": "2026-01-29T19:05:00Z"
  }
}
```

**响应示例** (404 Not Found):

```json
{
  "success": false,
  "error": {
    "code": "ACCOUNT_NOT_FOUND",
    "message": "Account 'agent1' not found"
  }
}
```

#### 8.2.2 查询所有账户额度

```
GET /api/resource/minimax/all
```

**响应示例** (200 OK):

```json
{
  "success": true,
  "data": {
    "accounts": [
      {
        "account": "default",
        "displayName": "默认账户",
        "model": "MiniMax-M2.1",
        "total": 1000000,
        "used": 750000,
        "remaining": 250000,
        "percentage": 75.0
      },
      {
        "account": "agent1",
        "displayName": "Agent 1",
        "model": "MiniMax-M2.1",
        "total": 500000,
        "used": 120000,
        "remaining": 380000,
        "percentage": 24.0
      }
    ],
    "summary": {
      "totalUsed": 870000,
      "totalRemaining": 630000,
      "totalPercentage": 58.0
    }
  }
}
```

#### 8.2.3 刷新单个账户额度

```
POST /api/resource/minimax/refresh
Content-Type: application/json

{
  "account": "default",
  "force": true  // 可选，强制刷新忽略缓存
}
```

**响应示例** (200 OK):

```json
{
  "success": true,
  "data": {
    "account": "default",
    "model": "MiniMax-M2.1",
    "total": 1000000,
    "used": 752000,
    "remaining": 248000,
    "percentage": 75.2,
    "cached": false,
    "cachedAt": "2026-01-29T19:10:00Z",
    "expiresAt": "2026-01-29T19:15:00Z"
  }
}
```

#### 8.2.4 刷新所有账户额度

```
POST /api/resource/minimax/refresh/all
```

**响应示例** (200 OK):

```json
{
  "success": true,
  "data": {
    "results": [
      { "account": "default", "success": true },
      { "account": "agent1", "success": true },
      { "account": "agent2", "success": false, "error": "Account disabled" }
    ],
    "total": 2,
    "success": 2,
    "failed": 0
  }
}
```

#### 8.2.5 查询历史记录

```
GET /api/resource/minimax/history?account={account}&limit={limit}&since={since}
```

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| account | string | 否 | 账户名，默认所有 |
| limit | number | 否 | 返回条数，默认 100 |
| since | string | 否 | 开始时间，ISO 8601 格式 |

**响应示例** (200 OK):

```json
{
  "success": true,
  "data": {
    "account": "default",
    "records": [
      {
        "timestamp": "2026-01-29T19:10:00Z",
        "used": 752000,
        "remaining": 248000,
        "percentage": 75.2
      },
      {
        "timestamp": "2026-01-29T19:05:00Z",
        "used": 750000,
        "remaining": 250000,
        "percentage": 75.0
      }
    ],
    "total": 2
  }
}
```

#### 8.2.6 获取账户配置

```
GET /api/settings/minimax/accounts
```

**响应示例** (200 OK):

```json
{
  "success": true,
  "data": {
    "accounts": [
      {
        "id": "default",
        "name": "default",
        "displayName": "默认账户",
        "cookiePath": "xhs-scraper/profile/minimaxi/cookies_default.json",
        "enabled": true,
        "priority": 0
      },
      {
        "id": "agent1",
        "name": "agent1",
        "displayName": "Agent 1",
        "cookiePath": "xhs-scraper/profile/minimaxi/cookies_agent1.json",
        "enabled": true,
        "priority": 1
      }
    ],
    "defaultAccount": "default"
  }
}
```

#### 8.2.7 更新账户配置

```
POST /api/settings/minimax/accounts
Content-Type: application/json

{
  "action": "update",  // update | add | delete
  "account": {
    "id": "agent2",
    "name": "agent2",
    "displayName": "Agent 2",
    "cookiePath": "xhs-scraper/profile/minimaxi/cookies_agent2.json",
    "enabled": false,
    "priority": 2
  }
}
```

**响应示例** (200 OK):

```json
{
  "success": true,
  "message": "Account 'agent2' updated successfully"
}
```

#### 8.2.8 切换账户启用状态

```
POST /api/settings/minimax/accounts/{id}/toggle
```

**响应示例** (200 OK):

```json
{
  "success": true,
  "data": {
    "id": "agent1",
    "enabled": false
  }
}
```

#### 8.2.9 健康检查

```
GET /api/health
```

**响应示例** (200 OK):

```json
{
  "status": "ok",
  "timestamp": "2026-01-29T19:10:00Z",
  "services": {
    "storage": "ok",
    "minimax": "ok"
  }
}
```

### 8.3 错误码定义

| 错误码 | HTTP 状态 | 说明 |
|--------|-----------|------|
| SUCCESS | 200 | 成功 |
| ACCOUNT_NOT_FOUND | 404 | 账户不存在 |
| ACCOUNT_DISABLED | 400 | 账户已禁用 |
| STORAGE_ERROR | 500 | 存储错误 |
| API_ERROR | 502 | MiniMax API 调用失败 |
| AUTH_ERROR | 401 | 认证失败 |
| RATE_LIMITED | 429 | 请求过于频繁 |

---

## 9. 数据结构

### 9.1 核心类型定义

```typescript
// src/minimax/types.ts

/**
 * MiniMax 使用量数据
 */
export interface MinimaxUsage {
  account: string;           // 账户标识
  model: string;             // 模型名称
  total: number;             // 总额度
  used: number;              // 已使用
  remaining: number;         // 剩余
  percentage: number;        // 使用百分比
  timestamp: string;         // 获取时间 ISO 8601
}

/**
 * MiniMax 账户配置
 */
export interface MinimaxAccount {
  id: string;                // 唯一标识 (default, agent1, agent2)
  name: string;              // 账户名称
  displayName: string;       // 显示名称
  cookiePath?: string;       // Playwright Profile 路径
  cookieJsonPath?: string;   // Cookie JSON 文件路径
  enabled: boolean;          // 是否启用
  priority: number;          // 优先级（显示顺序）
  createdAt?: string;        // 创建时间
  updatedAt?: string;        // 更新时间
}

/**
 * 账户配置列表
 */
export interface MinimaxAccountList {
  version: number;
  defaultAccount: string;
  accounts: MinimaxAccount[];
}

/**
 * 缓存条目
 */
export interface CacheEntry<T> {
  data: T;
  cachedAt: string;          // ISO 8601
  expiresAt: string;         // ISO 8601
}

/**
 * 历史记录条目
 */
export interface HistoryEntry {
  timestamp: string;         // ISO 8601
  account: string;
  used: number;
  remaining: number;
  percentage: number;
}

/**
 * 账户汇总
 */
export interface AccountSummary {
  account: string;
  displayName: string;
  model: string;
  total: number;
  used: number;
  remaining: number;
  percentage: number;
  cached?: boolean;
  cachedAt?: string;
}

/**
 * 所有账户汇总
 */
export interface AllAccountsSummary {
  accounts: AccountSummary[];
  summary: {
    totalUsed: number;
    totalRemaining: number;
    totalPercentage: number;
  };
}
```

### 9.2 信号类型定义

```typescript
// src/core/l5-signals/types.ts

/**
 * MiniMax 相关信号类型
 */
export type MinimaxSignalType =
  | 'minimax:refresh'      // 刷新请求
  | 'minimax:usage'        // 额度数据
  | 'minimax:cache_hit'    // 缓存命中
  | 'minimax:cache_miss'   // 缓存未命中
  | 'minimax:error';       // 错误

/**
 * 刷新信号
 */
export interface RefreshSignal {
  type: 'minimax:refresh';
  payload: {
    account: string;       // 账户标识
    force?: boolean;       // 是否强制刷新
    timestamp: string;
  };
}

/**
 * 额度信号
 */
export interface UsageSignal {
  type: 'minimax:usage';
  payload: {
    account: string;
    usage: MinimaxUsage;
    fromCache: boolean;
    timestamp: string;
  };
}

/**
 * 缓存命中信号
 */
export interface CacheHitSignal {
  type: 'minimax:cache_hit';
  payload: {
    account: string;
    cachedAt: string;
    expiresAt: string;
  };
}

/**
 * 缓存未命中信号
 */
export interface CacheMissSignal {
  type: 'minimax:cache_miss';
  payload: {
    account: string;
    reason: 'expired' | 'not_found';
  };
}

/**
 * 错误信号
 */
export interface ErrorSignal {
  type: 'minimax:error';
  payload: {
    account: string;
    error: string;
    code: string;
  };
}

/**
 * 信号联合类型
 */
export type MinimaxSignal =
  | RefreshSignal
  | UsageSignal
  | CacheHitSignal
  | CacheMissSignal
  | ErrorSignal;
```

### 9.3 存储类型定义

```typescript
// src/core/l2-storage/types.ts

/**
 * 存储层统一接口
 */
export interface Storage {
  /** 保存数据（覆盖） */
  save<T>(key: string, data: T): Promise<void>;

  /** 加载数据 */
  load<T>(key: string): Promise<T | null>;

  /** 追加数据（用于历史记录） */
  append(key: string, entry: unknown): Promise<void>;

  /** 查询 */
  query<T>(key: string, filter?: QueryFilter): Promise<T[]>;

  /** 删除 */
  delete(key: string): Promise<void>;
}

/**
 * 查询过滤器
 */
export interface QueryFilter {
  /** 开始时间 */
  since?: string;
  /** 结束时间 */
  until?: string;
  /** 限制条数 */
  limit?: number;
  /** 排序方式 */
  order?: 'asc' | 'desc';
}

/**
 * 存储配置
 */
export interface StorageConfig {
  /** 数据库路径 */
  path: string;
}
```

### 9.4 API 响应类型

```typescript
// src/core/l1-network/types.ts

/**
 * 通用 API 响应
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

/**
 * API 错误
 */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * 批量操作结果
 */
export interface BatchResult {
  total: number;
  success: number;
  failed: number;
  results: Array<{
    account: string;
    success: boolean;
    error?: string;
  }>;
}
```

---

## 10. 实现原则

### 10.1 核心原则

| 原则 | 说明 | 示例 |
|------|------|------|
| **存储抽象** | 上层只调用统一接口，不关心底层实现 | L4-Actor 调用 `storage.save()`，不知道是 SQLite |
| **信号隔离** | 获取和查询分离，信号池作为缓冲区 | 刷新请求 → SignalPool → Agent |
| **单一职责** | 每个模块只做一件事 | `SqliteStorage` 只管存储，`MinimaxAgent` 只管业务 |
| **依赖倒置** | 上层依赖接口，不依赖具体实现 | `MinimaxActor` 依赖 `Storage` 接口 |
| **不可变数据** | 缓存和历史记录不可变，只追加 | 历史记录只追加，不修改 |
| **错误处理** | 错误信号化，区分缓存错误和 API 错误 | `ErrorSignal` 包含错误码 |

### 10.2 代码规范

| 规范 | 说明 |
|------|------|
| **文件命名** | `kebab-case.ts` |
| **类命名** | `PascalCase` |
| **接口命名** | `PascalCase` + `I` 前缀（可选） |
| **函数命名** | `camelCase` |
| **异步函数** | 统一使用 `async/await` |
| **错误处理** | try-catch + 信号发送 |

### 10.3 测试规范

| 层级 | 测试内容 | 覆盖率要求 |
|------|----------|------------|
| 单元测试 | 存储层、信号池、Actor | 100% |
| 集成测试 | API 端点、数据流 | 100% |
| E2E 测试 | 页面交互、完整流程 | 核心路径 |

---

## 11. 实现优先级

### 11.1 Phase 1: 存储层和基础架构

| 优先级 | 任务 | 预计行数 | 依赖 |
|--------|------|----------|------|
| P0 | 创建 `types.ts` 接口定义 | 100 | - |
| P0 | 实现 `sqlite-storage.ts` | 300 | types.ts |
| P层入口0 | 创建存储 `index.ts` | 50 | sqlite-storage.ts |
| P1 | 初始化 SQLite 数据库 | 100 | sqlite-storage.ts |

### 11.2 Phase 2: 信号池层

| 优先级 | 任务 | 预计行数 | 依赖 |
|--------|------|----------|------|
| P0 | 创建信号类型定义 `types.ts` | 150 | - |
| P0 | 实现 `signal-pool.ts` 核心 | 200 | types.ts |
| P1 | 实现 `minimax-signal-handler.ts` | 150 | signal-pool.ts |

### 11.3 Phase 3: Actor 层

| 优先级 | 任务 | 预计行数 | 依赖 |
|--------|------|----------|------|
| P0 | 创建 Actor 类型 `types.ts` | 80 | - |
| P0 | 实现 `minimax-actor.ts` | 200 | Storage, types.ts |
| P1 | 依赖注入初始化 | 50 | minimax-actor.ts |

### 11.4 Phase 4: Agent 层

| 优先级 | 任务 | 预计行数 | 依赖 |
|--------|------|----------|------|
| P0 | 实现 `minimax-agent.ts` | 200 | MinimaxActor |
| P1 | 实现 `client.ts` (Playwright) | 300 | - |

### 11.5 Phase 5: 网络层

| 优先级 | 任务 | 预计行数 | 依赖 |
|--------|------|----------|------|
| P0 | 实现 `minimax-handler.ts` | 200 | MinimaxAgent |
| P0 | 添加路由配置 | 100 | router.ts |
| P1 | 健康检查端点 | 50 | - |

### 11.6 Phase 6: 前端

| 优先级 | 任务 | 预计行数 | 依赖 |
|--------|------|----------|------|
| P1 | 实现 `useMinimax.ts` Hook | 100 | API |
| P1 | 实现 `ResourceCard.tsx` 组件 | 150 | API |
| P1 | 实现 `ResourcePage.tsx` 页面 | 200 | ResourceCard.tsx |
| P2 | 实现 `SettingsPage.tsx` 页面 | 250 | API |

### 11.7 Phase 7: 测试和文档

| 优先级 | 任务 | 预计行数 | 依赖 |
|--------|------|----------|------|
| P1 | 单元测试 | 300 | 各模块 |
| P1 | 集成测试 | 200 | API |
| P2 | E2E 测试 | 150 | 页面 |

---

## 12. UI 设计

### 12.1 页面结构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         exomind - 资源监控                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────┐ ┌─────────────────────────────────────────────────┐   │
│  │          │ │                                                 │   │
│  │  侧边栏   │ │   ┌─────────────────────────────────────────┐  │   │
│  │          │ │   │                                         │  │   │
│  │  主页     │ │   │   📊 MiniMax 资源监控                   │  │   │
│  │  📈 资源   │ │   │                                         │  │   │
│  │  💬 对话   │ │   │   ┌─────────────────────────────────┐  │  │   │
│  │  📋 任务   │ │   │   │  默认账户                         │  │  │   │
│  │  💰 财务   │ │   │   ├─────────────────────────────────┤  │  │   │
│  │  ⚙️ 设置   │ │   │   │  MiniMax-M2.1                    │  │  │   │
│  │          │ │   │   │                                 │  │  │   │
│  │          │ │   │   │   ████████████████░░░░░ 75%      │  │  │   │
│  │          │ │   │   │                                 │  │  │   │
│  │          │ │   │   │   已用: 750K  │ 剩余: 250K       │  │  │   │
│  │          │ │   │   └─────────────────────────────────┘  │  │   │
│  │          │ │   │                                         │  │   │
│  │          │ │   │   ┌─────────────────────────────────┐  │  │   │
│  │          │ │   │   │  Agent 1                        │  │  │   │
│  │          │ │   │   ├─────────────────────────────────┤  │  │   │
│  │          │ │   │   │  MiniMax-M2.1                    │  │  │   │
│  │          │ │   │   │                                 │  │  │   │
│  │          │ │   │   │   ██████████░░░░░░░░░░░ 24%      │  │  │   │
│  │          │ │   │   │                                 │  │  │   │
│  │          │ │   │   │   已用: 120K │ 剩余: 380K        │  │  │   │
│  │          │ │   │   └─────────────────────────────────┘  │  │   │
│  │          │ │   │                                         │  │   │
│  │          │ │   │   ┌─────────────────────────────────┐  │  │   │
│  │          │ │   │   │  [+] 添加账户                     │  │  │   │
│  │          │ │   │   └─────────────────────────────────┘  │  │   │
│  │          │ │   │                                         │  │   │
│  │          │ │   │   [🔄 刷新全部]  [📈 历史记录]          │  │   │
│  │          │ │   │                                         │  │   │
│  │          │ │   └─────────────────────────────────────────┘  │  │
│  │          │ │                                                 │  │
│  └──────────┘ └─────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 12.2 资源卡片设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                      资源卡片组件设计                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  📦 默认账户                           [⚙️] [🗑️]               ││
│  ├─────────────────────────────────────────────────────────────────┤│
│  │                                                                 ││
│  │  🤖 MiniMax-M2.1                                              ││
│  │                                                                 ││
│  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ││
│  │  75%                                                              ││
│  │                                                                 ││
│  │  ┌──────────────────┐  ┌──────────────────┐                     ││
│  │  │ 已用              │  │ 剩余              │                     ││
│  │  │ 🔵 750,000        │  │ 🟢 250,000       │                     ││
│  │  └──────────────────┘  └──────────────────┘                     ││
│  │                                                                 ││
│  │  ⏱️ 更新于: 19:10  │  ⏳ 过期于: 19:15  │  [🔄 刷新]              ││
│  │                                                                 ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 12.3 设置页面设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                      设置页面 - 账户管理                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ⚙️ MiniMax 账户设置                                               │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  账户列表                                                       ││
│  ├─────────────────────────────────────────────────────────────────┤│
│  │                                                                 ││
│  │  ┌───────────────────────────────────────────────────────────┐ ││
│  │  │ ☑️ 默认账户                    优先级: 0  ↑↓               │ ││
│  │  │    路径: xhs-scraper/profile/minimaxi/...                 │ ││
│  │  └───────────────────────────────────────────────────────────┘ ││
│  │                                                                 ││
│  │  ┌───────────────────────────────────────────────────────────┐ ││
│  │  │ ☑️ Agent 1                      优先级: 1  ↑↓               │ ││
│  │  │    路径: xhs-scraper/profile/minimaxi/...                 │ ││
│  │  └───────────────────────────────────────────────────────────┘ ││
│  │                                                                 ││
│  │  ┌───────────────────────────────────────────────────────────┐ ││
│  │  │ ☐ Agent 2 (已禁用)                优先级: 2  ↑↓            │ ││
│  │  │    路径: xhs-scraper/profile/minimaxi/...                 │ ││
│  │  └───────────────────────────────────────────────────────────┘ ││
│  │                                                                 ││
│  │  ┌───────────────────────────────────────────────────────────┐ ││
│  │  │ [+] 添加新账户                                             │ ││
│  │  └───────────────────────────────────────────────────────────┘ ││
│  │                                                                 ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  [💾 保存设置]  [❌ 取消]                                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 12.4 历史记录页面设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                      历史记录 - 使用趋势                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  📈 默认账户 - 使用历史                                              │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                                                             │   │
│  │      │                                                       │   │
│  │ 100% │            ╱╲                                          │   │
│  │      │           ╱  ╲                                         │   │
│  │   75%│    ╱╲─────╱    ╲───╱╲                                │   │
│  │      │   ╱  ╲             ╱  ╲                               │   │
│  │   50%│──╱    ╲────────────╱    ╲────                         │   │
│  │      │                                                       │   │
│  │   25%│                                                       │   │
│  │      │                                                       │   │
│  │    0%│                                                       │   │
│  │      └────────────────────────────────────────────────────── │   │
│  │         19:00   19:05   19:10   19:15   19:20   19:25       │   │
│  │                                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  时间范围: [📅 最近1小时 ▼]  [📥 导出 CSV]                          │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 时间                已用        剩余        变化              │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ 19:25:00          755,000     245,000     +3,000  ↑         │   │
│  │ 19:20:00          752,000     248,000     +2,000  ↑         │   │
│  │ 19:15:00          750,000     250,000     +0     -          │   │
│  │ 19:10:00          750,000     250,000     +5,000  ↑         │   │
│  │ 19:05:00          745,000     255,000     +0     -          │   │
│  │ 19:00:00          745,000     255,000     -                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  [◀️ 下一页]  页码 1/10  [下一页 ▶️]                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 13. 自动化测试

### 13.1 单元测试

#### 13.1.1 存储层测试

```typescript
// tests/unit/storage.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/core/l2-storage/sqlite-storage.js';
import type { Storage } from '../../src/core/l2-storage/types.js';

describe('SqliteStorage', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = new SqliteStorage({ path: ':memory:' });
  });

  describe('save & load', () => {
    it('should save and load simple data', async () => {
      const data = { name: 'test', value: 123 };
      await storage.save('test:key1', data);

      const loaded = await storage.load<typeof data>('test:key1');
      expect(loaded).toEqual(data);
    });

    it('should return null for non-existent key', async () => {
      const loaded = await storage.load('test:non-existent');
      expect(loaded).toBeNull();
    });

    it('should overwrite existing data', async () => {
      await storage.save('test:key', { v: 1 });
      await storage.save('test:key', { v: 2 });

      const loaded = await storage.load<{ v: number }>('test:key');
      expect(loaded?.v).toBe(2);
    });
  });

  describe('append & query', () => {
    it('should append data to history', async () => {
      await storage.append('history', { id: 1, value: 'a' });
      await storage.append('history', { id: 2, value: 'b' });

      const results = await storage.query<{ id: number; value: string }>('history');
      expect(results).toHaveLength(2);
      expect(results[0].value).toBe('a');
      expect(results[1].value).toBe('b');
    });

    it('should support limit filter', async () => {
      for (let i = 0; i < 10; i++) {
        await storage.append('history', { id: i });
      }

      const results = await storage.query<{ id: number }>('history', { limit: 5 });
      expect(results).toHaveLength(5);
    });

    it('should support since filter', async () => {
      await storage.append('history', { id: 1, timestamp: '2026-01-29T18:00:00Z' });
      await storage.append('history', { id: 2, timestamp: '2026-01-29T19:00:00Z' });

      const results = await storage.query<{ id: number }>(
        'history',
        { since: '2026-01-29T18:30:00Z' }
      );
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(2);
    });
  });

  describe('delete', () => {
    it('should delete existing data', async () => {
      await storage.save('test:key', { v: 1 });
      await storage.delete('test:key');

      const loaded = await storage.load('test:key');
      expect(loaded).toBeNull();
    });
  });
});
```

**期望结果**：
- 所有测试通过
- 覆盖率：100%

#### 13.1.2 Actor 测试

```typescript
// tests/unit/actor.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MinimaxActor } from '../../src/core/l4-actor/minimax-actor.js';
import type { Storage } from '../../src/core/l2-storage/types.js';

describe('MinimaxActor', () => {
  let actor: MinimaxActor;
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = {
      save: vi.fn(),
      load: vi.fn(),
      append: vi.fn(),
      query: vi.fn(),
      delete: vi.fn(),
    };
    actor = new MinimaxActor(mockStorage);
  });

  describe('saveCache', () => {
    it('should save cache with timestamp', async () => {
      const usage = createMockUsage('default');
      await actor.saveCache('default', usage);

      expect(mockStorage.save).toHaveBeenCalledWith(
        'cache:default',
        expect.objectContaining({
          data: usage,
          cachedAt: expect.any(String),
        })
      );
    });
  });

  describe('loadCache', () => {
    it('should return cached data', async () => {
      const usage = createMockUsage('default');
      mockStorage.load.mockResolvedValue({ data: usage });

      const result = await actor.loadCache('default');

      expect(result).toEqual(usage);
    });

    it('should return null when cache not found', async () => {
      mockStorage.load.mockResolvedValue(null);

      const result = await actor.loadCache('default');

      expect(result).toBeNull();
    });
  });

  describe('appendHistory', () => {
    it('should append history entry', async () => {
      const usage = createMockUsage('default');
      await actor.appendHistory(usage);

      expect(mockStorage.append).toHaveBeenCalledWith(
        'history',
        expect.objectContaining({
          account: 'default',
          used: usage.used,
          remaining: usage.remaining,
          percentage: usage.percentage,
        })
      );
    });
  });

  describe('accounts', () => {
    it('should load accounts', async () => {
      const accounts = [createMockAccount('default')];
      mockStorage.load.mockResolvedValue(accounts);

      const result = await actor.loadAccounts();

      expect(result).toEqual(accounts);
    });

    it('should save accounts', async () => {
      const accounts = [createMockAccount('default')];
      await actor.saveAccounts(accounts);

      expect(mockStorage.save).toHaveBeenCalledWith('accounts', accounts);
    });
  });
});
```

**期望结果**：
- 所有测试通过
- 覆盖率：100%

#### 13.1.3 信号池测试

```typescript
// tests/unit/signals.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { SignalPool } from '../../src/core/l5-signals/signal-pool.js';
import type { MinimaxSignal } from '../../src/core/l5-signals/types.js';

describe('SignalPool', () => {
  let pool: SignalPool<MinimaxSignal>;

  beforeEach(() => {
    pool = new SignalPool<MinimaxSignal>();
  });

  describe('emit & on', () => {
    it('should emit signal and trigger handler', async () => {
      const handler = vi.fn();
      pool.on('minimax:refresh', handler);

      pool.emit({
        type: 'minimax:refresh',
        payload: { account: 'default', timestamp: new Date().toISOString() },
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'minimax:refresh',
          payload: expect.objectContaining({ account: 'default' }),
        })
      );
    });

    it('should support multiple handlers', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      pool.on('minimax:refresh', handler1);
      pool.on('minimax:refresh', handler2);

      pool.emit({
        type: 'minimax:refresh',
        payload: { account: 'default', timestamp: new Date().toISOString() },
      });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('once', () => {
    it('should only trigger once', async () => {
      const handler = vi.fn();
      pool.once('minimax:refresh', handler);

      pool.emit({
        type: 'minimax:refresh',
        payload: { account: 'default', timestamp: new Date().toISOString() },
      });
      pool.emit({
        type: 'minimax:refresh',
        payload: { account: 'default', timestamp: new Date().toISOString() },
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('off', () => {
    it('should remove handler', async () => {
      const handler = vi.fn();

      pool.on('minimax:refresh', handler);
      pool.off('minimax:refresh', handler);

      pool.emit({
        type: 'minimax:refresh',
        payload: { account: 'default', timestamp: new Date().toISOString() },
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
```

**期望结果**：
- 所有测试通过
- 覆盖率：100%

### 13.2 集成测试

```typescript
// tests/integration/minimax.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/core/l1-network/server.js';
import type { Storage } from '../../src/core/l2-storage/types.js';
import type { MinimaxActor } from '../../src/core/l4-actor/minimax-actor.js';

describe('MiniMax API Integration', () => {
  let server: ReturnType<typeof createServer>;
  let storage: Storage;
  let actor: MinimaxActor;

  beforeAll(async () => {
    // 初始化存储
    storage = new SqliteStorage({ path: ':memory:' });

    // 初始化 Actor
    actor = new MinimaxActor(storage);

    // 初始化服务器
    server = createServer({ actor, storage });
    server.listen(1954);
  });

  afterAll(() => {
    server.close();
  });

  describe('GET /api/resource/minimax', () => {
    it('should return 404 for non-existent account', async () => {
      const res = await fetch('http://localhost:1954/api/resource/minimax?account=non-existent');
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('ACCOUNT_NOT_FOUND');
    });
  });

  describe('GET /api/resource/minimax/all', () => {
    it('should return empty list when no accounts', async () => {
      const res = await fetch('http://localhost:1954/api/resource/minimax/all');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.accounts).toEqual([]);
    });
  });

  describe('POST /api/resource/minimax/refresh', () => {
    it('should return error for disabled account', async () => {
      // 先添加一个禁用账户
      await storage.save('accounts', [
        { id: 'test', name: 'test', displayName: 'Test', enabled: false, priority: 0 }
      ]);

      const res = await fetch('http://localhost:1954/api/resource/minimax/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: 'test' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('ACCOUNT_DISABLED');
    });
  });
});
```

**期望结果**：
- 所有测试通过
- 覆盖率：100%

### 13.3 E2E 测试

```typescript
// tests/e2e/resource-page.test.ts

import { test, expect } from '@playwright/test';

test.describe('Resource Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:1921/resources');
  });

  test('should display resource cards', async ({ page }) => {
    // 等待页面加载
    await expect(page.locator('text=MiniMax 资源监控')).toBeVisible();

    // 检查是否有账户卡片
    await expect(page.locator('text=默认账户')).toBeVisible();
  });

  test('should refresh data when clicking refresh button', async ({ page }) => {
    // 点击刷新按钮
    await page.click('button:has-text("刷新")');

    // 检查加载状态
    await expect(page.locator('text=加载中...')).toBeVisible();

    // 等待加载完成
    await expect(page.locator('text=加载中...')).not.toBeVisible();

    // 验证数据已更新
    await expect(page.locator('text=已用:')).toBeVisible();
  });

  test('should navigate to settings page', async ({ page }) => {
    // 点击设置按钮
    await page.click('a:has-text("设置")');

    // 验证设置页面
    await expect(page.locator('text=MiniMax 账户设置')).toBeVisible();
  });
});
```

**期望结果**：
- 所有 E2E 测试通过
- 核心路径 100% 覆盖

---

## 14. 验收标准

### 14.1 功能验收

| 编号 | 验收标准 | 验收方式 | 状态 |
|------|----------|----------|------|
| AC01 | 用户可以在主页看到 MiniMax 账户额度 | E2E 测试 | ⏳ |
| AC02 | 额度显示真实数据（非模拟） | 手动验证 | ⏳ |
| AC03 | 支持多账户显示和切换 | E2E 测试 | ⏳ |
| AC04 | 用户可以手动刷新额度 | E2E 测试 | ⏳ |
| AC05 | 数据有 5 分钟缓存 | 集成测试 | ⏳ |
| AC06 | 对外 API 可查询额度 | API 测试 | ⏳ |
| AC07 | 账户配置可添加/删除/禁用 | E2E 测试 | ⏳ |
| AC08 | 历史记录持久化存储 | 集成测试 | ⏳ |

### 14.2 性能验收

| 编号 | 验收标准 | 验收方式 | 目标 |
|------|----------|----------|------|
| PC01 | API 响应时间 < 100ms（缓存命中） | 性能测试 | < 100ms |
| PC02 | 页面加载时间 < 2s | 性能测试 | < 2s |
| PC03 | 并发请求处理正常 | 负载测试 | 10 QPS |

### 14.3 安全验收

| 编号 | 验收标准 | 验收方式 | 状态 |
|------|----------|----------|------|
| SC01 | 敏感配置不暴露在 API 响应 | 安全测试 | ⏳ |
| SC02 | SQL 注入防护 | 安全测试 | ⏳ |
| SC03 | 错误信息不泄露敏感数据 | 安全测试 | ⏳ |

### 14.4 测试覆盖率验收

| 层级 | 覆盖率要求 | 当前 |
|------|------------|------|
| 单元测试 | 100% | ⏳ |
| 集成测试 | 100% | ⏳ |
| E2E 核心路径 | 100% | ⏳ |

---

## 附录

### A. 变更记录

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v1.0 | 2026-01-29 | Claude | 初始版本 |

### B. 参考文档

| 文档 | 路径 |
|------|------|
| 7 层架构说明 | `docs/specs/ARCHITECTURE_7LAYER.md` |
| 信号池设计 | `docs/specs/SIGNAL_POOL.md` |
| 存储层抽象 | `docs/specs/STORAGE_ABSTRACTION.md` |

### C. 相关 Spec

| Spec 编号 | 主题 |
|-----------|------|
| SPEC-021 | CLI 工具 |
| SPEC-020 | 7 层架构 |

---

*文档创建时间：2026-01-29*
*版本：v1.0*

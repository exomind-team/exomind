# ExoBuffer Connector 技术需求报告

> 本报告基于项目源码分析生成，用于指导使用其他技术框架重新实现 ExoBuffer Connector。

## 1. 项目概述

### 核心定位
ExoBuffer 是一个**事件采集与实时同步系统**，用于从多种来源（手动输入、API、工具）采集事件数据，并以 append-only 方式持久化存储，支持多客户端通过 Server-Sent Events (SSE) 实时同步消息。

### 技术栈
| 层级 | 当前技术 | 可迁移目标 |
|------|---------|-----------|
| 前端框架 | React 18 + TypeScript + Vite + Tailwind CSS | Vue 3 / Svelte / SolidJS |
| 桌面封装 | Tauri 2.0 (Rust) | Electron / Tauri 2.0 |
| 后端框架 | Rust + Axum 0.7 | Node.js / Go / Python / Deno |
| 数据存储 | JSONL 文件 | SQLite / PostgreSQL / 文件存储 |
| 实时通信 | SSE (Server-Sent Events) | WebSocket / SSE |
| 构建工具 | Vite + Cargo | 任意前端构建工具 |

---

## 2. 核心功能模块

### 2.1 Fact 采集与存储
- **功能描述**: 通过 POST `/api/fact` 接口接收外部输入事件，以 append-only 方式写入 JSONL 文件
- **数据来源**: `manual`（手动输入）、`api`（API 发送）、`tool`（工具采集）
- **存储格式**: `data/facts.jsonl`，每行一个 JSON 对象
- **自动备份**: 每 200 条数据自动备份到 `backup/facts.jsonl.{timestamp}.bak`

### 2.2 实时消息同步 (SSE)
- **功能描述**: 基于 SSE 的多客户端实时广播，新消息自动推送到所有连接客户端
- **事件类型**: `connected`、`new_fact`、`heartbeat`
- **心跳间隔**: 30 秒
- **客户端管理**: 原子计数器追踪连接数
- **话题过滤**: 支持 `topics_and`（全部匹配）和 `topics_or`（任一匹配）两种筛选模式

### 2.3 消息展示与交互
- **消息顺序**: 支持两种展示模式（微信风格：新下旧上 / 看板风格：新上旧下）
- **Markdown 渲染**: 支持标题、粗体、列表、链接、代码等基础语法
- **话题标签**: 消息支持 `#话题名` 标签，按消息数量自动排序
- **发送者标识**: 基于 source + IP 生成 HSL 动态颜色区分不同发送者
- **消息引用**: 支持回复引用功能，点击可跳转到原始消息

### 2.4 消息过滤与搜索
- **内容过滤**: `"关键词"` 用引号包裹，支持多个关键词（AND 逻辑）
- **话题过滤**: `#话题名` 支持多个话题（AND 逻辑）
- **URL 参数**: 支持 `limit`、`since`、`topics`、`fact-id` 等 URL 参数控制显示

### 2.5 Analysis 分析流
- **功能描述**: Agent 可对 Fact 追加解释性输出，保持数据单向依赖
- **分析类型**: `sentiment`、`note`、`hint`、`link` 等
- **置信度**: 0.0-1.0 的置信度分数

---

## 3. 数据模型

### 3.1 Fact 实体
```json
{
  "fact_id": "f-737f92e969c2433c9455c8e1e831c867",
  "timestamp": 1736784000000,
  "source": "clipboard",
  "content_type": "text",
  "content": "消息内容",
  "meta": {
    "sender": "user-123",
    "reply_to": "f-abc123",
    "clipboard": true,
    "ip": "192.168.1.1",
    "user_agent": "ExoBuffer-CLI/0.3.0",
    "topics": ["#dev", "#general"]
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| fact_id | String | 是 | 格式 `f-{uuid}`，全局唯一 |
| timestamp | i64 | 是 | 毫秒级 Unix 时间戳 |
| source | String | 是 | 枚举: `manual`/`api`/`tool` |
| content_type | String | 是 | 枚举: `text`/`url` |
| content | String | 是 | 原始输入内容，禁止加工 |
| meta | Object | 是 | 元数据对象 |

### 3.2 FactMeta 实体
| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| sender | String | ≤64字符 | 发送者身份标识 |
| reply_to | String | 可选 | 回复引用的 fact_id |
| clipboard | Boolean | 可选 | 是否来自剪贴板 |
| ip | String | 可选 | 采集端 IP |
| user_agent | String | 可选 | 客户端标识 |
| topics | Array | 可选 | 话题标签集合 |
| extra | Object | 可选 | 扩展字段容器 |

### 3.3 Analysis 实体
```json
{
  "analysis_id": "a-abc123",
  "timestamp": 1736784000000,
  "fact_id": "f-737f92e969c2433c9455c8e1e831c867",
  "analysis_type": "sentiment",
  "result": "positive",
  "confidence": 0.95,
  "meta": null
}
```

### 3.4 核心原则
1. **单一事实原则**: Fact 是唯一具有事实地位的数据，历史不会被覆盖
2. **单向依赖原则**: Analysis 只能引用 Fact，Fact 不依赖 Analysis
3. **Append-Only 原则**: JSONL 文件仅允许尾部追加，禁止 UPDATE/DELETE

---

## 4. API 接口规范

### 4.1 REST API 端点

| 端点 | 方法 | 功能 | 请求/响应 |
|------|------|------|-----------|
| `/api/fact` | POST | 创建 Fact | 请求: `CreateFactRequest`; 响应: `Fact` (201) |
| `/api/facts` | GET | 获取 Fact 列表 | 查询: `since`, `limit`, `topics_and`, `topics_or`; 响应: `Vec<Fact>` |
| `/api/fact/:fact_id` | GET | 获取单个 Fact | 响应: `Fact` (200/404) |
| `/api/analysis` | GET | 获取分析结果 | 响应: `Vec<Analysis>` |
| `/api-docs/openapi.json` | GET | OpenAPI 文档 | 响应: JSON 格式规范 |

### 4.2 SSE 实时事件流

```
GET /api/events?topics_and=dev,ai&topics_or=python
Accept: text/event-stream
```

**事件格式:**
```
event: connected
data: {"count":1}

event: new_fact
data: {"fact_id":"...","timestamp":...,"source":"...","content":"...","meta":{...}}

event: heartbeat
data:
```

### 4.3 查询参数

| 参数 | 类型 | 说明 |
|------|------|------|
| since | i64 | 时间戳阈值，只返回大于此时间戳的消息 |
| limit | usize | 返回消息数量上限 |
| topics_and | String | 逗号分隔，消息需包含所有话题 (AND) |
| topics_or | String | 逗号分隔，消息只需包含任一话题 (OR) |

### 4.4 错误码

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 201 | Fact 创建成功 |
| 400 | 请求参数错误 |
| 404 | Fact 不存在 |
| 500 | 服务器内部错误 |

---

## 5. 前端功能

### 5.1 UI 组件结构

| 组件 | 职责 |
|------|------|
| App.tsx | 主应用组件，协调各子组件，管理全局状态 |
| MessageList.tsx | 消息列表渲染，处理滚动锚点、消息操作 |
| MessageInput.tsx | 消息输入组件，支持多行输入、自动高度调整 |
| FilterBar.tsx | 过滤器栏，提供内容/话题过滤的添加、移除交互 |
| ConnectionStatus.tsx | 连接状态指示器，显示在线/离线状态 |
| MessageContent.tsx | 消息内容渲染（Markdown 支持） |
| MarkdownRenderer.tsx | Markdown 格式渲染组件 |

### 5.2 前端状态管理

```typescript
App 组件状态:
├── messages: Fact[]              // 消息列表
├── source: string                // 来源标识（默认 'human'）
├── sender: string                // 发送者名称（localStorage 持久化）
├── messageOrder: 'newest-top' | 'newest-bottom'  // 消息顺序
├── showSettings: boolean         // 设置面板显示
├── filterString: string          // 过滤器字符串（localStorage 持久化）
├── notificationSound: SoundId | 'off'  // 提示音设置
├── replyToFact: Fact | null      // 当前引用消息
└── scrollToAnchor: string | null // 锚点滚动目标
```

### 5.3 SSE 客户端实现
- **连接管理**: `useSSE` hook 管理 EventSource 连接
- **重连策略**: 指数退避 (3s → 30s)
- **事件监听**: `new_fact` 和 `analysis` 事件类型
- **提示音控制**: 只对非自己发送的消息播放提示音

### 5.4 用户操作流程

```
场景 A：发送消息
1. 在输入框输入内容
2. 可选：添加话题标签 (#话题名)
3. 点击发送或按 Enter
4. 消息实时显示在列表中

场景 B：过滤消息
1. 在 FilterBar 输入过滤条件
2. 支持 "关键词" 和 #话题名 语法
3. 消息列表实时筛选

场景 C：查看消息历史
1. 页面加载时获取历史消息
2. SSE 实时接收新消息
3. 新消息自动滚动显示
```

---

## 6. Tauri 桌面应用

### 6.1 窗口配置
```json
{
  "title": "ExoBuffer",
  "width": 800,
  "height": 600,
  "resizable": true,
  "fullscreen": false
}
```

### 6.2 系统集成能力
- **Shell 集成**: 支持打开外部链接（HTTP、HTTPS、tel:、mailto:）
- **自定义协议**: 通过自定义协议访问本地资源
- **跨平台打包**: 支持 Windows、macOS、Linux
- **权限控制**: 基于 Capability 的细粒度权限系统

### 6.3 当前状态
- 已完成: 窗口基础配置、权限系统设置、打包配置
- 待扩展: 文件系统访问、系统托盘、窗口事件处理、通知集成、自动更新

---

## 7. 用户使用场景

### 场景 1: 信息采集与记录
用户或 Agent 将外部输入（如剪贴板内容、工具输出）通过 API 提交到 ExoBuffer，系统以不可变方式存储原始数据，保持数据完整性，支持多客户端同时连接实时共享信息。

### 场景 2: 多端协作通讯
用户通过不同设备（手机、平板、电脑）访问同一消息空间，每个设备可以设置不同的 sender 身份标识，消息实时同步，支持团队协作场景。

### 场景 3: Agent 数据通道
Scout Agent 等 AI Agent 通过 Analysis 流对 Fact 进行解释和分析，Agent 只能追加 Analysis，不能修改历史 Fact，实现人机协作的信息处理工作流。

### 场景 4: 消息聚合与回顾
用户累积大量消息后，需要快速查找历史内容，支持按内容、时间、来源等多维度筛选，支持关键词搜索和高亮显示。

---

## 8. 待实现功能清单

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 消息搜索 | High | 客户端实时关键词搜索，结果高亮显示 |
| 消息筛选 | High | 按时间范围、内容类型、来源筛选消息 |
| 链接预览 | High | URL 消息显示为链接预览卡片 |
| JSONL 导出 | High | 客户端触发导出 facts.jsonl |
| 消息同步修复 | High | 修复多客户端 SSE 同步 Bug |
| 时间戳格式化 | Medium | 将 Unix 时间戳转为人类可读格式 |
| 消息提示音 | Medium | 新消息到达时播放提示音，支持开关 |
| 深色模式 | Low | 支持深色/浅色主题切换 |
| 图片支持 | Low | 图片上传与显示 |
| Android 构建 | - | Android APK 构建配置 |

---

## 9. 技术依赖分析

### 9.1 必须保留的依赖
| 依赖 | 用途 | 替代方案 |
|------|------|----------|
| SSE / WebSocket | 实时消息推送 | 任意支持服务端推送的技术 |
| JSON 序列化 | 数据存储与传输 | 任意 JSON 库 |
| HTTP 服务器 | API 服务 | 任意 Web 框架 |

### 9.2 可替换的技术点
| 当前技术 | 可替换为 |
|----------|----------|
| Rust + Axum | Node.js + Express/Fastify, Go + Gin/Echo, Python + FastAPI |
| React + Vite | Vue 3 + Vite, Svelte + Vite, SolidJS + Vite |
| Tauri 2.0 | Electron, Tauri 1.x |
| JSONL 文件 | SQLite, PostgreSQL, LevelDB |
| Tailwind CSS | 任意 CSS 框架或原生 CSS |
| date-fns | 任意日期处理库 |

### 9.3 关键算法/逻辑
1. **话题过滤逻辑**: AND 模式（全部匹配）和 OR 模式（任一匹配）
2. **SSE 重连策略**: 指数退避算法 (3s → 30s)
3. **消息排序**: 两种展示模式（微信风格/看板风格）
4. **发送者颜色生成**: 基于 source + IP 的 HSL 动态颜色

---

## 10. 迁移建议

### 10.1 后端迁移要点
1. 实现 `/api/fact` POST 接口，创建 Fact 并追加到 JSONL 文件
2. 实现 `/api/facts` GET 接口，支持 `since`、`limit`、`topics_and`、`topics_or` 查询参数
3. 实现 `/api/events` SSE 接口，使用发布/订阅模式广播新消息
4. 实现心跳机制（30秒间隔）和客户端连接计数
5. 实现自动备份机制（每200条数据备份）

### 10.2 前端迁移要点
1. 实现 SSE 客户端连接管理，支持重连策略
2. 实现消息过滤语法解析（`"关键词"` 和 `#话题名`）
3. 实现 Markdown 渲染和渐进式时间戳显示
4. 实现消息列表的两种展示模式
5. 实现 URL 参数解析（`limit`、`since`、`topics`、`fact-id`）

### 10.3 数据迁移
- JSONL 文件格式保持兼容
- Fact ID 格式保持 `f-{uuid}`
- Analysis ID 格式保持 `a-{uuid}`
- 时间戳使用毫秒级 Unix 时间戳

---

**报告生成时间**: 2026-02-03
**调研范围**: 8个模块并行分析
**数据来源**: 项目源码、规范文档、README

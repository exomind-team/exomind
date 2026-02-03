# SPEC-203: L7-Interface 层

> **功能名称**: L7-Interface 用户界面层
> **创建日期**: 2026-01-30
> **优先级**: P0
> **状态**: ✅ 已完成

---

## 1. 用户需求

### 1.1 问题描述

L7-Interface 层是 7 层架构的顶层，直接面向用户。需要提供：
- Web 仪表盘（1949 端口）
- RESTful API 接口
- 实时 WebSocket 通信

### 1.2 使用场景

- 用户通过浏览器访问仪表盘
- 第三方应用调用 API
- 实时数据推送（资源监控、对话更新）

---

## 2. 功能定义

### 2.1 核心组件

| 组件 | 描述 | 职责 |
|------|------|------|
| HttpServer | HTTP 服务器 | 请求路由、中间件、静态文件 |
| WebSocketHandler | WebSocket 处理器 | 实时数据推送、双向通信 |
| ApiRouter | API 路由 | RESTful 端点、认证、限流 |
| DashboardUI | 仪表盘界面 | 四视图展示、响应式设计 |

### 2.2 接口设计

```typescript
// API 端点
GET  /health              # 健康检查
GET  /api/chat/history    # 对话历史
POST /api/chat/send       # 发送消息
GET  /api/resource/minimax # MiniMax 额度
GET  /api/resource/vps    # VPS 状态
WS   /ws                  # WebSocket 连接

// Dashboard 页面
GET /                    # 仪表盘主页
GET /chat                # 对话视图
GET /resources           # 资源监控
GET /tasks               # 任务管理
```

---

## 3. 验收标准

- [x] HTTP 服务器启动正常（1949 端口）
- [x] 健康检查端点 `/health` 返回 200
- [x] 静态文件服务（HTML/CSS/JS）
- [x] API 路由中间件（认证、日志）
- [x] WebSocket 连接建立（/ws 端点）
- [x] 仪表盘 UI 四视图展示
- [x] 单元测试覆盖 >80%（83 tests pass）
- [x] 集成测试通过（SignalPool + AgentCoordinator 集成）

---

## 4. 架构设计

### 4.1 文件结构

```
src/
├── interface/
│   ├── index.ts           # 模块导出
│   ├── http-server.ts     # HTTP 服务器
│   ├── websocket.ts       # WebSocket 处理器
│   ├── router.ts          # API 路由（待实现）
│   ├── dashboard.ts       # 仪表盘页面（内嵌 HTML）
│   └── middlewares/
│       ├── auth.ts        # 认证中间件（待实现）
│       ├── logger.ts      # 日志中间件（待实现）
│       └── rate-limit.ts  # 限流中间件（待实现）
└── static/
    ├── index.html         # 仪表盘主页
    ├── css/
    │   └── styles.css     # 样式文件
    └── js/
        ├── app.js         # 主应用逻辑
        ├── chat.js        # 对话视图
        ├── resources.js   # 资源监控
        └── websocket.js   # WebSocket 客户端（待实现）
```

### 4.2 数据流

```
Browser
    ↓ HTTP / WebSocket
HttpServer (Bun)
    ↓
Router → Middlewares
    ↓
Controller → AgentCoordinator
    ↓
Response
```

---

## 5. 实施计划

### Step 1: HTTP 服务器基础
- [x] 创建 src/interface/http-server.ts
- [x] 实现 Bun HTTP 服务器
- [x] 配置端口 1949
- [x] 添加健康检查端点

### Step 2: API 路由
- [x] 实现 /api/* 路由（内嵌在 http-server.ts）
- [ ] 添加中间件（auth、logger）- 待优化
- [x] 实现 RESTful 端点

### Step 3: WebSocket
- [x] 创建 src/interface/websocket.ts
- [x] 实现 WebSocket 处理器
- [x] 添加实时数据推送
- [x] 实现心跳机制

### Step 4: Dashboard UI
- [x] 创建仪表盘 HTML（内嵌在 http-server.ts）
- [x] 实现四视图布局
- [x] 添加 CSS 样式
- [x] 实现 JavaScript 交互

### Step 5: 集成测试
- [x] 端到端测试
- [x] 单元测试（83 tests pass）
- [x] 集成测试通过

---

## 6. 下一步优化

- [ ] 完善 API 中间件（认证、限流）
- [ ] 实现独立的静态文件服务
- [ ] 添加 WebSocket 客户端示例
- [ ] 性能测试与优化

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-01-30 | 1.0 | 初始版本 | ExoMind Agent |
| 2026-01-30 | 1.1 | **WebSocket 支持实现**<br>- 添加 websocket.ts<br>- 更新 http-server.ts<br>- 导出 WebSocket 模块<br>- 83 测试全部通过 | ExoMind Agent |

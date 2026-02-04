# ExoMind 7层架构

## 概述

ExoMind采用7层架构模型，从UI展示层到平台适配层，实现跨平台的生命成长助手系统。

```
┌─────────────────────────────────────────────────────────────────────┐
│                     ExoMind 7 层架构                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  L7-UI 前端展示层 (React + TypeScript)                               │
│      ↓ IPC (Tauri invoke)                                           │
│  L6 核心业务逻辑层 (Claude Runner, Agent Layer)                       │
│      ↓                                                              │
│  L5  SignalPool (发布-订阅信号系统)                                   │
│      ↓                                                              │
│  L4  终端执行器 (跨平台命令执行)                                       │
│      ↓                                                              │
│  L3  平台适配层 (Windows/macOS/Linux/Android)                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## L7 - UI前端展示层

**技术栈**: React + TypeScript + Tailwind CSS + shadcn/ui

**职责**:
- 用户界面渲染
- 用户交互处理
- 状态展示与反馈

**核心组件**:
- Terminal - 终端界面
- Chat - 对话界面
- Settings - 设置界面

---

## L6 - 核心业务逻辑层

**职责**:
- Agent调度与管理
- 跨平台通信协调
- 业务规则执行

### 架构组件

| 组件 | Desktop | Mobile | 说明 |
|------|---------|--------|------|
| **WebSocket Server** | Rust (Tauri Backend) | - | 桌面端作为服务端 |
| **WebSocket Client** | - | Rust (Tauri Plugin) | 移动端作为客户端 |
| **Sync Protocol** | 统一消息格式 | 统一消息格式 | 跨设备消息同步 |
| **Agent Runner** | Claude API | Claude API | AI Agent执行 |
| **Governor** | 调控中枢 | 调控中枢 | 输出治理与权限控制 |

### 多端通信架构

```
┌─────────────────┐                      ┌─────────────────┐
│   Desktop App   │ ◄──── WebSocket ───► │   Mobile App    │
│  (Server Mode)  │                      │  (Client Mode)  │
│                 │                      │                 │
│ ┌─────────────┐ │                      │ ┌─────────────┐ │
│ │ WS Server   │ │                      │ │ WS Client   │ │
│ │ (Rust)      │ │                      │ │ (Tauri)     │ │
│ └─────────────┘ │                      │ └─────────────┘ │
│        │        │                      │        │        │
│        ▼        │                      │        ▼        │
│ ┌─────────────┐ │                      │ ┌─────────────┐ │
│ │ Sync Engine │ │                      │ │ Sync Engine │ │
│ └─────────────┘ │                      │ └─────────────┘ │
└─────────────────┘                      └─────────────────┘
```

### 统一消息格式 (Sync Protocol)

```typescript
interface SyncMessage {
  id: string;           // 消息唯一标识
  type: MessageType;    // 消息类型
  timestamp: number;    // 时间戳
  payload: unknown;     // 消息内容
  source: DeviceType;   // 来源设备
  signature?: string;   // 签名验证
}

type MessageType = 
  | 'chat'      // 对话消息
  | 'task'      // 任务状态
  | 'signal'    // 信号通知
  | 'presence'  // 在线状态
  | 'command';  // 控制命令

type DeviceType = 'desktop' | 'mobile' | 'web';
```

---

## L5 - SignalPool (发布-订阅信号系统)

**职责**:
- 解耦生产者与消费者
- 事件总线管理
- 信号路由与分发

**核心功能**:
- 信号注册与订阅
- 信号发布与广播
- 信号过滤与转换

---

## L4 - 终端执行器

**职责**:
- 跨平台命令执行
- 进程管理
- 输出捕获

**支持平台**:
- Windows (PowerShell/CMD)
- macOS/Linux (Bash/Zsh)
- Android (受限沙箱)

---

## L3 - 平台适配层

**职责**:
- 操作系统API抽象
- 平台特定功能实现
- 权限管理

**适配器**:
- Windows Adapter
- macOS Adapter
- Linux Adapter
- Android Adapter

---

## 层间通信

| 层级 | 通信方式 | 说明 |
|------|----------|------|
| L7 ↔ L6 | Tauri IPC | invoke/handle |
| L6 ↔ L5 | 直接调用 | Rust函数调用 |
| L5 ↔ L4 | 信号触发 | 异步消息 |
| L4 ↔ L3 | 系统API | 平台特定接口 |

---

## 架构决策记录

详见 [DECISIONS/](./DECISIONS/) 目录下的ADR文档。


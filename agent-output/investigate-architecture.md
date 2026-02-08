# 代码现状报告：ExoMind 核心实现

> **评审人：** Code Investigator
> **日期：** 2026-02-08
> **评审范围：** `src/` 核心代码

---

## 1. 文件结构概览

```
src/
├── lib/                      # 核心库
│   ├── timeblock/          # 时间块模块
│   │   ├── index.ts        # 统一导出
│   │   ├── types.ts        # 类型定义（Event, TimeBlock, PlannedTimeBlock）
│   │   ├── store.ts        # Zustand store
│   │   └── persistence.ts   # 持久化
│   │
│   ├── sync/               # 同步模块
│   │   ├── index.ts        # 统一导出
│   │   ├── message-storage.ts  # 消息存储
│   │   ├── device-pairing.ts  # 设备配对
│   │   └── offline.ts      # 离线支持
│   │
│   ├── p2p/                # P2P 模块
│   │   ├── index.ts        # 统一导出
│   │   ├── types.ts        # 类型定义
│   │   └── manager.ts      # P2P 管理器
│   │
│   ├── ws/                 # WebSocket 模块
│   │   ├── client.ts      # WebSocket 客户端
│   │   └── ...
│   │
│   ├── types/              # 类型导出
│   │   └── index.ts
│   ├── eventlog/          # 事件日志格式
│   └── db/                 # 数据库模块
│
├── components/             # React 组件
│   ├── Chat/              # 聊天页面
│   │   └── ChatPage.tsx
│   ├── Settings/          # 设置页面
│   │   └── SettingsPage.tsx
│   ├── Pairing/           # 配对组件
│   ├── Layout/            # 布局组件
│   └── ui/                 # shadcn/ui 基础组件
│
├── hooks/                  # 自定义 Hooks
├── stores/                 # Zustand stores
│   ├── chat-store.ts
│   └── timeblock-store.ts
├── routes.tsx              # 路由配置
└── main.tsx               # 应用入口
```

---

## 2. API 接口分析

### 2.1 公开 API（按模块）

| 模块 | 导出接口 | 说明 |
|------|----------|------|
| **timeblock** | `useTimeBlockStore` | Zustand store，管理事件/时间块 |
| | `initTimeBlockStore()` | 初始化 store |
| | `hasActiveBlock()` | 检查是否有活跃块 |
| | `getActiveBlock()` | 获取活跃块 |
| | `parseTimeBlockCommand()` | 解析命令（开始/结束） |
| **sync** | `getMessageStorage()` | 获取消息存储单例 |
| | `OfflineQueue` | 离线队列 |
| | `PairingResult` | 配对结果类型 |
| **p2p** | `getP2PManager()` | 获取 P2P 管理器 |
| | `P2PManager` | P2P 连接管理类 |
| | `destroyP2PManager()` | 销毁管理器 |

### 2.2 消息存储 API

```typescript
// message-storage.ts
class MessageStorage {
  // 消息管理
  async saveMessage(message: ChatMessage): Promise<void>
  async getMessages(limit?: number): Promise<ChatMessage[]>
  async getMessagesWithDevice(deviceId: string): Promise<ChatMessage[]>

  // 消息创建
  createOutgoingMessage(content: string, receiverId: string): ChatMessage
  createSyncMessage(message: ChatMessage): SyncMessage

  // 事件监听
  onMessage(handler: (msg: ChatMessage) => void): void
  handleIncomingMessage(syncMsg: SyncMessage): void

  // 设备
  getDeviceId(): string
}
```

### 2.3 P2P 管理器 API

```typescript
// p2p/manager.ts
class P2PManager {
  // 连接管理
  async connect(config: P2PConfig): Promise<ConnectionResult>
  async disconnect(): Promise<void>

  // 状态
  getState(): ConnectionStatus
  onStateChange(listener: P2PEventListener): void

  // 设备
  async getPairedDevices(): Promise<Device[]>
  async pairDevice(request: PairingRequest): Promise<PairingResult>
  async unpairDevice(deviceId: string): Promise<void>
}
```

---

## 3. UI 实现分析

### 3.1 聊天页面（ChatPage.tsx）

**功能：**
- 消息列表展示（按日期分组）
- 消息输入框
- 时间块命令解析（"开始XXX" / "结束"）
- 时间块状态显示

**组件结构：**
```
ChatPage
├── 消息列表 (ScrollView)
│   └── 按日期分组的事件卡片
├── 输入区域
│   └── Input + Send Button
└── 时间块状态指示器
```

**问题观察：**
- `+` 按钮存在但无功能（PR #15 Bug）
- 输入框支持时间块命令解析
- 消息和时间块事件合并显示

### 3.2 设置页面（SettingsPage.tsx）

**功能：**
- 本机 IP/端口显示
- 连接状态展示
- 设备配对（生成/输入配对码）
- 已配对设备管理
- 消息导出/数据备份

**组件结构：**
```
SettingsPage
├── 网络状态
│   ├── 本机地址（IP + 端口）
│   └── 连接状态指示器
├── 已配对设备列表
├── 设备配对
│   ├── 生成配对码按钮
│   └── 输入配对码表单
├── IP 直连（兼容旧版）
├── 消息导出
├── 数据备份
└── 安全提示
```

### 3.3 shadcn/ui 基础组件

使用的基础组件：
- `Button` - 按钮
- `Input` - 输入框
- `Badge` - 标签
- `Avatar` - 头像
- `Dialog` - 对话框
- `Card` - 卡片

---

## 4. 平台适配分析

### 4.1 Tauri 适配

**文件：** `src/lib/sync/message-storage.ts`

```typescript
const isTauri = typeof window !== 'undefined' && window.__TAURI__ !== undefined;

// Tauri 模式：调用 Rust 后端
const tauriStorage = {
  async writeFile(path: string, data: string) {
    await invoke('write_file', { path, content: data });
  },
  async readTextFile(path: string) {
    return await invoke('read_file', { path }) as string;
  },
  async appendFile(path: string, data: string) {
    await invoke('append_file', { path, content: data });
  },
};
```

**适配的 Tauri 命令：**
- `write_file` - 写入文件
- `read_file` - 读取文件
- `append_file` - 追加文件
- `get_device_id` - 获取设备 ID
- `get_local_ip_with_random_port` - 获取本机 IP
- `ws_send` - 发送 WebSocket 消息

### 4.2 Web 降级

**问题刚修复：** PR #15 Bug - 消息持久化失效

```typescript
// Web 模式：localStorage 降级
const webStorage = {
  async writeFile(path: string, data: string) {
    localStorage.setItem(`exomind:${path}`, data);
  },
  async readTextFile(path: string) {
    return localStorage.getItem(`exomind:${path}`) || '';
  },
  async appendFile(path: string, data: string) {
    const existing = localStorage.getItem(`exomind:${path}`) || '';
    localStorage.setItem(`exomind:${path}`, existing + data);
  },
};
```

**Web 限制：**
- localStorage 容量限制（通常 5MB）
- 没有文件系统 API
- 没有 Tauri IPC

### 4.3 待完善的平台适配

| 功能 | Tauri | Web | 状态 |
|------|-------|-----|------|
| 文件存储 | ✅ invoke | ⚠️ localStorage | 刚修复 |
| WebSocket | ✅ invoke | ⚠️ 需原生实现 | 未完成 |
| P2P 连接 | ✅ libp2p (Rust) | ❌ 不支持 | 未实现 |
| 设备发现 | ✅ 后端支持 | ❌ 不支持 | 未实现 |

---

## 5. 存储实现分析

### 5.1 数据模型

**消息（ChatMessage）：**
```typescript
interface ChatMessage {
  id: string;
  type: 'chat';
  content: string;
  timestamp: number;
  senderId: string;
  receiverId: string;
  status: 'pending' | 'sending' | 'sent' | 'delivered' | 'failed';
  direction?: 'outgoing' | 'incoming';
  deviceId?: string;
}
```

**事件（Event）：**
```typescript
interface Event {
  id: UUID;
  timestamp: Timestamp;
  content: NoteContent;
  tags: Set<Tag>;
  meta?: JSONObject;
}
```

**时间块（TimeBlock）：**
```typescript
interface TimeBlock {
  id: UUID;
  name: string;
  note?: string;
  startId: UUID;
  endId?: UUID;
  tags: Set<Tag>;
  meta?: JSONObject;
}
```

### 5.2 持久化策略

| 数据类型 | 存储方式 | 文件/键 |
|---------|---------|----------|
| 消息 | JSONL（追加写入） | `.exomind/messages.jsonl` |
| 设备 ID | localStorage | `exomind:deviceId` |
| 时间块 | Zustand persist | `timeblock-storage` (localStorage) |

**问题：**
- 消息使用 JSONL 格式追加写入，但读取时每次解析整个文件
- 没有索引，查询效率低
- localStorage 容量限制可能导致写入失败

---

## 6. 功能覆盖状态

### 6.1 已实现功能 ✅

| 功能 | 状态 | 说明 |
|------|------|------|
| 消息发送/接收 | ✅ | 基础聊天功能 |
| 时间块 | ✅ | 开始/结束命令解析 |
| 事件记录 | ✅ | Event/TimeBlock 模型 |
| 消息持久化 | ✅ | 刚修复 Web 端问题 |
| 设备配对 | ✅ | 配对码生成/验证 |
| WebSocket 连接 | ⚠️ 部分 | 需要后端支持 |
| P2P 连接 | ⚠️ 框架 | 类型定义完成，逻辑待实现 |
| 离线队列 | ⚠️ 框架 | OfflineQueue 已定义 |
| 响应式布局 | ✅ | 1024px 断点 |

### 6.2 部分实现功能 ⚠️

| 功能 | 问题 |
|------|------|
| WebSocket | 需要 Rust 后端支持 |
| P2P 同步 | 架构已设计，libp2p 集成未完成 |
| 多设备同步 | 冲突解决策略未定义 |

### 6.3 缺失功能 ❌

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 消息搜索 | P2 | 需实现全文搜索 |
| 消息过滤 | P2 | 按日期/设备过滤 |
| 数据导出格式 | P2 | 当前仅支持 JSON |
| 导入功能 | P2 | 仅支持追加导入 |
| 深色模式 | P3 | 未实现 |
| 插件系统 | P3 | 架构未设计 |
| CRDT 同步 | P1 | P2P 冲突解决需要 |

---

## 7. 潜在问题识别

### 7.1 严重问题（P0）

1. **Web 端持久化刚修复，需充分测试**
   - localStorage 写入可能失败（容量限制）
   - 没有优雅的错误处理

2. **P2P 同步架构未完成**
   - `p2p/manager.ts` 类型完整，但逻辑实现状态未知
   - 冲突解决策略缺失

### 7.2 中等问题（P1）

1. **JSONL 读取效率低**
   - 每次读取解析整个文件
   - 没有分页或索引

2. **缺少错误边界处理**
   - 网络错误没有用户友好的提示
   - 离线状态提示不清晰

### 7.3 轻微问题（P2）

1. **UI 组件复用性不足**
   - 一些组件逻辑与 UI 耦合

2. **测试覆盖率不足**
   - 单元测试刚起步
   - E2E 测试不完整

---

## 8. 架构一致性检查

### 8.1 与 7 层架构的一致性

| 层 | 实现状态 | 说明 |
|----|----------|------|
| L7-UI | ✅ | React + TypeScript + shadcn/ui |
| L6-业务逻辑 | ⚠️ 部分 | Claude Runner 未实现 |
| L5-SignalPool | ❌ | 未实现 |
| L4-执行器 | ⚠️ 部分 | WebSocket/P2P 待完成 |
| L3-平台适配 | ⚠️ 部分 | Web 降级刚修复 |

### 8.2 类型定义一致性

- `timeblock/types.ts` 与 `types/` 有重复导出
- `p2p/types.ts` 与 `sync/message-storage.ts` 有部分重叠

---

## 9. 建议事项

### 9.1 短期（P0）

1. **充分测试 Web 端持久化**
   - 添加 localStorage 容量检测
   - 添加写入失败的用户提示

2. **完成 P2P 管理器实现**
   - 检查 `p2p/manager.ts` 逻辑实现状态
   - 定义冲突解决策略

### 9.2 中期（P1）

1. **优化消息存储**
   - 添加简单索引
   - 或迁移到 IndexedDB（Web 端）

2. **完善错误处理**
   - 网络状态统一管理
   - 用户友好的错误提示

### 9.3 长期（P2）

1. **实现 SignalPool（L5）**
   - 发布-订阅消息系统
   - 解耦组件间通信

2. **添加搜索/过滤功能**
   - 本地搜索
   - 时间/设备过滤

---

## 10. 文件清单

### 10.1 核心类型文件

| 文件 | 功能 | 状态 |
|------|------|------|
| `src/lib/timeblock/types.ts` | Event/TimeBlock 类型 | ✅ 完整 |
| `src/lib/p2p/types.ts` | P2P 连接类型 | ✅ 完整 |
| `src/lib/types/event.ts` | Event 类型导出 | ⚠️ 冗余 |
| `src/lib/types/message.ts` | 消息类型导出 | ⚠️ 冗余 |

### 10.2 Store 文件

| 文件 | 功能 | 状态 |
|------|------|------|
| `src/lib/stores/chat-store.ts` | 聊天状态管理 | ✅ 完整 |
| `src/lib/stores/timeblock-store.ts` | 时间块状态管理 | ✅ 完整 |

### 10.3 组件文件

| 文件 | 功能 | 状态 |
|------|------|------|
| `src/components/Chat/ChatPage.tsx` | 聊天页面 | ✅ 功能完整，UI 待优化 |
| `src/components/Settings/SettingsPage.tsx` | 设置页面 | ✅ 功能完整 |

---

## 参考文件

1. `docs/architecture/MVP.md` - MVP 架构设计
2. `docs/architecture/MVP-ARCHITECTURE.md` - 详细架构文档
3. `src/lib/timeblock/types.ts` - 时间块类型定义
4. `src/lib/p2p/types.ts` - P2P 类型定义
5. `src/components/Chat/ChatPage.tsx` - 聊天页面实现

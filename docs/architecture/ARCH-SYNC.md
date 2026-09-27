# ARCH-SYNC: 多设备同步模块架构分析

> 分析日期：2026-02-10
> 分析人：Architect

---

## 1. 执行摘要

本文档分析了 ExoMind 多设备同步模块的当前架构状态，评估其是否符合 v4 分层架构原则，并提出优化建议。

**主要发现**：
- 同步模块部分符合 v4 架构
- 存在多处架构违规和技术债务
- 需要系统性重构以达到架构一致性

---

## 2. 当前架构总览

### 2.1 模块分布

```
src/
├── adapters/                    # L1 Adapter
│   ├── crypto-adapter.ts        # 加密适配器 ✅
│   └── pouch-sync.ts            # PouchDB 同步适配器 ⚠️
│
├── environment/                  # L2 Port
│   └── interfaces/
│       ├── crypto.port.ts       # 加密 Port ✅
│       └── sync.port.ts         # 同步 Port ⚠️
│
├── lib/
│   ├── sync/                    # ⚠️ 混合层
│   │   ├── message-storage.ts   # Message 存储
│   │   └── conflict-resolver.ts # 冲突解决（纯函数）
│   │
│   └── storage/
│       └── event-storage.ts     # Event 存储 ⚠️
│
└── ui/
    └── stores/
        └── sync-store.ts       # L4/L3 混合 ⚠️
```

### 2.2 架构合规性矩阵

| 模块 | 当前层 | 应归属层 | 合规 | 差距 |
|------|--------|----------|------|------|
| crypto-adapter.ts | L1 Adapter | L1 Adapter | ✅ | 无 |
| pouch-sync.ts | L1 Adapter | L1 Adapter | ⚠️ | 类型重复 |
| crypto.port.ts | L2 Port | L2 Port | ✅ | 无 |
| sync.port.ts | L2 Port | L2 Port | ⚠️ | 接口未完整使用 |
| event-storage.ts | `lib/storage/` | L1 Adapter | ❌ | 目录不规范 |
| message-storage.ts | `lib/sync/` | L3 Service | ⚠️ | 混合职责 |
| conflict-resolver.ts | `lib/sync/` | Utility | ✅ | 纯函数 |
| sync-store.ts | L4 UI | L3/L4 混合 | ⚠️ | 业务逻辑过重 |

---

## 3. 模块关系图

### 3.1 当前架构（问题）

```
┌─────────────────────────────────────────────────────────────────┐
│  L4 UI                                                          │
│  ChatPage ──────► EventStorage (直接依赖) ⚠️                     │
│       │                                                                │
│       └──► sync-store.ts (状态管理 + 业务逻辑) ⚠️                   │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  缺失的 L3 Service 层                                            │
│         （业务逻辑散落在 L4 和 L1 中）                              │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  L2 Port（部分定义）                                              │
│  sync.port.ts ───► pouch-sync.ts (类型重复) ⚠️                    │
│  crypto.port.ts ───► crypto-adapter.ts ✅                        │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  L1 Adapter                                                     │
│  pouch-sync.ts ───► PouchDB (实现)                               │
│  crypto-adapter.ts ───► Web Crypto API ✅                       │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ (WS/HTTP)
┌─────────────────────────────────────────────────────────────────┐
│  后端服务                                                        │
│  PouchDB Server (端口 6984)                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 目标架构

```
┌─────────────────────────────────────────────────────────────────┐
│  L4 UI                                                          │
│  ChatPage ──────► useEventStore ─────► EventService (L3)         │
│       │                          │                                │
│       └──► useSyncStore ──────► SyncService (L3)                │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  L3 Service                                                     │
│  EventService ───► IEventPort (L2)                             │
│  SyncService ───► ISyncPort (L2)                                │
│  UserService ───► IUserPort (L2)                                 │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  L2 Environment                                                 │
│  Environment ───► 持有所有 Port 实例                             │
│       │                                                            │
│       ├──► IEventPort ───► EventStorageAdapter (L1)             │
│       ├──► ISyncPort ───► PouchSyncAdapter (L1)                 │
│       ├──► ICryptoPort ───► CryptoAdapter (L1)                  │
│       └──► IUserPort ───► UserAdapter (L1)                      │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  L1 Adapter                                                     │
│  EventStorageAdapter ───► PouchDB                              │
│  PouchSyncAdapter ───► PouchDB + WebSocket                     │
│  CryptoAdapter ───► Web Crypto API                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. 数据流向分析

### 4.1 事件同步数据流

```
当前实现（问题）：

1. 用户发送消息
   ChatPage.handleSend()
           │
           ▼
   EventStorage.addEvent()  ⚠️ UI 直接调用 Adapter
           │
           ▼
   PouchDB 本地存储
           │
           ▼
   storage.syncToRemote()   ⚠️ 同步逻辑在 Adapter 中
           │
           ▼
   WebSocket ──────► PouchDB Server
```

```
目标实现：

1. 用户发送消息
   ChatPage.handleSend()
           │
           ▼
   EventService.addEvent()  ✅ L3 Service
           │
           ▼
   IEventPort.addEvent()     ✅ L2 Port 接口
           │
           ▼
   EventStorageAdapter       ✅ L1 Adapter
           │
           ▼ (同步触发)
   ISyncPort.syncEvents()    ✅ 独立同步逻辑
           │
           ▼
   WebSocket ──────► PouchDB Server
```

### 4.2 数据格式转换

| 转换点 | 当前实现 | 问题 | 目标实现 |
|--------|----------|------|----------|
| Event → StorageEvent | ChatPage | UI 层处理格式转换 | Service 层 |
| ChatMessage → EventLog | MessageStorage | 混在一起 | 独立 Mapper |
| 密码哈希 | sync-store.ts | UI 层处理 | Service 层 |

---

## 5. 问题清单

### 5.1 严重问题（P0）

| ID | 问题 | 影响 | 位置 |
|----|------|------|------|
| P0-1 | EventStorage 目录不规范 | 违反 v4 架构 | `src/lib/storage/` |
| P0-2 | UI 直接实例化 Adapter | 紧耦合，无法测试 | ChatPage:33 |
| P0-3 | 缺少 IEventPort 接口 | 无法替换实现 | 全局 |
| P0-4 | sync-store 混合业务逻辑 | 违反单一职责 | sync-store.ts |

### 5.2 中等问题（P1）

| ID | 问题 | 影响 | 位置 |
|----|------|------|------|
| P1-1 | pouch-sync 重复定义类型 | 维护困难 | pouch-sync.ts |
| P1-2 | 硬编码同步服务器 URL | 配置不灵活 | ChatPage:63 |
| P1-3 | message-storage 与 Tauri 耦合 | Web 环境问题 | message-storage.ts:11 |
| P1-4 | Event/Message 类型重复 | 维护困难 | 多处 |

### 5.3 轻微问题（P2）

| ID | 问题 | 影响 | 位置 |
|----|------|------|------|
| P2-1 | 缺少 Service 接口定义文件 | 架构不完整 | `services/interfaces/` |
| P2-2 | Environment 未持有 Port 实例 | 无法依赖注入 | environment.ts |
| P2-3 | 冲突解决在 Adapter 外使用 | 职责不清 | 待定 |

---

## 6. 技术债务分析

### 6.1 代码重复

| 类型 | 实例 | 建议 |
|------|------|------|
| SyncStatus | sync.port.ts, pouch-sync.ts | 复用 port.ts |
| Event 类型 | event-storage.ts, types/event.ts | 统一使用 |
| DeviceInfo | 多处 | 统一到 device-manager |

### 6.2 违反的设计原则

| 原则 | 违反实例 | 后果 |
|------|----------|------|
| 依赖倒置 | UI 直接 `new EventStorage()` | 无法替换实现 |
| 单一职责 | sync-store 包含业务逻辑 | 难以测试和维护 |
| 接口隔离 | Adapter 直接被 UI 调用 | 紧耦合 |
| 开闭原则 | 添加新存储需修改 UI | 扩展困难 |

---

## 7. 优化建议

### 7.1 短期优化（P0 - 立即修复）

```
1. 迁移 EventStorage 到正确目录
   src/lib/storage/event-storage.ts
   → src/adapters/event-storage.ts

2. 定义 IEventPort 接口
   src/environment/interfaces/event.port.ts

3. 创建 EventStorageAdapter 类（复用 EventStorage）
```

### 7.2 中期优化（P1 - 下一个迭代）

```
1. 创建 Service 层
   src/services/interfaces/event.service.ts
   src/services/impl/event.service.ts

2. 重构 sync-store.ts
   - 移除业务逻辑
   - 委托给 Service 层
   - 只保留 UI 状态管理

3. 统一类型定义
   - 删除 pouch-sync.ts 中的重复类型
   - 统一使用 sync.port.ts
```

### 7.3 长期优化（P2 - 规划中）

```
1. 实现完整的 Environment 模式
   - bootstrap.ts 检测运行时
   - 组装 Adapter 实例
   - 持有 Port 实例

2. 添加依赖注入
   - 使用 Container 或类似模式
   - 简化组件依赖

3. 完善测试覆盖
   - Service 层单元测试
   - Adapter 层集成测试
```

---

## 8. 迁移路径

### 8.1 Phase 1: 修复目录结构

```typescript
// BEFORE
import { EventStorage } from '@/lib/storage/event-storage';

// AFTER
import { EventStorageAdapter } from '@/adapters/event-storage';
```

### 8.2 Phase 2: 添加 Port 接口

```typescript
// src/environment/interfaces/event.port.ts

export interface IEventPort {
  addEvent(event: Event): Promise<void>;
  getEvents(): Promise<Event[]>;
  deleteEvent(id: string): Promise<void>;
  syncToRemote(url: string): Promise<void>;
}
```

### 8.3 Phase 3: 创建 Service 层

```typescript
// src/services/interfaces/event.service.ts

export interface IEventService {
  addEvent(content: string): Promise<void>;
  getEvents(): Promise<Event[]>;
  // 业务方法（不是存储方法）
  searchEvents(query: string): Promise<Event[]>;
}
```

---

## 9. 风险评估

### 9.1 迁移风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 功能回归 | 同步功能可能失效 | 渐进式迁移 |
| 测试覆盖不足 | 难以验证迁移正确性 | 先添加测试 |
| 性能下降 | 额外抽象层开销 | 性能基准测试 |

### 9.2 兼容性

| 场景 | 影响 | 建议 |
|------|------|------|
| 现有用户数据 | PouchDB 格式兼容 | 无需迁移 |
| 远程服务器 | API 保持不变 | 无需更改 |
| Tauri/Web 双端 | 运行时检测已存在 | 保持兼容 |

---

## 10. 验收标准

### 10.1 架构合规

- [ ] EventStorage 在 `src/adapters/`
- [ ] 定义 IEventPort 接口
- [ ] sync-store 只管 UI 状态
- [ ] pouch-sync 复用 sync.port.ts 类型

### 10.2 功能正常

- [ ] 事件添加/删除正常
- [ ] 远程同步正常工作
- [ ] 冲突检测和解决正常
- [ ] 用户认证正常

### 10.3 可测试性

- [ ] Service 层可独立测试
- [ ] Adapter 可 Mock
- [ ] UI 组件可测试

---

## 11. 附录

### A. 相关文档

| 文档 | 路径 |
|------|------|
| v4 架构规范 | `docs/architecture/7-LAYER.md` |
| SPEC-301 多设备同步 | `docs/specs/sync.md` |
| SPEC-302 密码哈希 | `docs/specs/auth.md` |
| SPEC-303 sync 模块 | `docs/specs/sync.md` |

### B. 文件清单

| 文件 | 状态 | 建议 |
|------|------|------|
| `src/adapters/crypto-adapter.ts` | ✅ 正常 | 保持 |
| `src/adapters/pouch-sync.ts` | ⚠️ 需修复 | 复用类型 |
| `src/adapters/event-storage.ts` | 📋 新建 | 迁移 |
| `src/environment/interfaces/*.port.ts` | ⚠️ 不完整 | 添加 IEventPort |
| `src/services/interfaces/*.service.ts` | ❌ 缺失 | 创建 |
| `src/services/impl/*.service.ts` | ❌ 缺失 | 创建 |
| `src/ui/stores/sync-store.ts` | ⚠️ 需重构 | 拆分职责 |

### C. 术语表

| 术语 | 定义 |
|------|------|
| Port | L2 接口层，定义能力契约 |
| Adapter | L1 具体实现，按运行时替换 |
| Service | L3 业务逻辑层 |
| Environment | L2 环境层，持有 Port 实例 |

---

*文档版本: 1.0*
*更新日期: 2026-02-10*

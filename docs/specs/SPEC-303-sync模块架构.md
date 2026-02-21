# SPEC-303: sync 模块架构设计

## 1. 概述

### 1.1 功能描述

实现多设备数据同步功能，基于 PouchDB 实现本地数据库与远程服务器之间的双向同步。

### 1.2 核心目标

- **实时同步**：WebSocket 优先，定时轮询可选
- **离线支持**：断网时本地 PouchDB 工作，联网自动同步
- **冲突检测**：LWW（最后写入胜）+ 冲突 UI 显示
- **用户隔离**：每个用户独立数据库

---

## 2. 架构设计

### 2.1 v4 分层定位

```
┌─────────────────────────────────────────────────────────────────┐
│  L4 UI                                                          │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ UserManagePage   │  │ SyncTestPage      │                │
│  └────────┬─────────┘  └────────┬─────────┘                  │
│           │                     │                             │
│           └──────────┬──────────┘                             │
│                      ▼                                        │
│           ┌─────────────────────┐                            │
│           │   useSyncStore      │ ← Zustand Store (L4/L3)   │
│           └──────────┬──────────┘                            │
└──────────────────────┼────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  L3 Service / Actor                                              │
│           (可选，sync-store 已集成 Adapter)                      │
└──────────────────────┬────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  L2 Environment                                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  ISyncPort (Port 接口 - 已定义)                          │  │
│  │  ├── connect(url, credentials)                          │  │
│  │  ├── disconnect()                                        │  │
│  │  ├── syncEvents() / syncConfig()                        │  │
│  │  ├── pushEvent() / pushConfig()                         │  │
│  │  └── getConflicts() / resolveConflict()                  │  │
│  └────────────────────────┬────────────────────────────────┘  │
└───────────────────────────┼────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  L1 Adapter                                                     │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  PouchSyncAdapter                                        │  │
│  │  ├── 本地 PouchDB (local_{username})                    │  │
│  │  └── 远程 PouchDB (HTTP/WebSocket)                     │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼ (WS / HTTP)
┌─────────────────────────────────────────────────────────────────┐
│  后端服务 (Bun + PouchDB Server)                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  PouchDB Server (独立用户数据库)                         │  │
│  │  ├── user-alice.db  (认证: username + password hash)   │  │
│  │  ├── user-bob.db                                        │  │
│  │  └── ...                                                │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 文件结构

```
src/
├── adapters/
│   └── pouch-sync.ts           # [已实现] PouchSyncAdapter
│
├── environment/
│   └── interfaces/
│       └── sync.port.ts        # [已定义] ISyncPort 接口 + 类型
│
└── ui/
    └── stores/
        └── sync-store.ts       # [已实现] Zustand Store

server/
├── pouchdb-server.js           # PouchDB Server
├── config.js                   # 配置
└── package.json               # 依赖

tests/
└── sync/
    ├── sync.port.test.ts      # [待实现] ISyncPort 测试
    └── conflict.test.ts       # [已存在] 冲突解决测试
```

### 2.3 类型复用关系

```
sync.port.ts (L2 Port)
├── enum DeviceType
├── type SyncState
├── type SyncMode
├── type ConflictResolution
├── type ImportStrategy
├── type DocType
├── type ConfigScope
├── interface SyncCredentials
├── interface SyncStatus
├── interface SyncResult
├── interface Conflict
├── interface ImportResult
├── interface DeviceInfo
├── interface ConfigDoc
└── interface SyncEvent

         ↓ 复用

pouch-sync.ts (L1 Adapter)
├── class PouchSyncAdapter
└── interface ISyncPort (应删除，复用 sync.port.ts)

         ↓ 集成

sync-store.ts (L4/L3)
└── useSyncStore
```

---

## 3. 接口设计

### 3.1 ISyncPort 接口（已定义）

```typescript
// src/environment/interfaces/sync.port.ts

export interface ISyncPort {
  // === 连接管理 ===
  connect(url: string, credentials: SyncCredentials): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): SyncStatus;

  // === 事件同步 ===
  syncEvents(): Promise<SyncResult>;
  pushEvent(event: SyncEvent): Promise<void>;

  // === 配置同步 ===
  syncConfig(): Promise<SyncResult>;
  pushConfig(key: string, value: unknown): Promise<void>;

  // === 冲突处理 ===
  getConflicts(): Promise<Conflict[]>;
  resolveConflict(docId: string, resolution: ConflictResolution): Promise<void>;

  // === 导入导出 ===
  importFromLocal(strategy: ImportStrategy): Promise<ImportResult>;
  exportToFile(): Promise<void>;

  // === 同步触发机制 ===
  setOnSyncTrigger(callback: SyncTriggerCallback): void;
  triggerSync(docType: DocType): Promise<void>;
}
```

### 3.2 核心类型

```typescript
// 同步状态
interface SyncStatus {
  state: 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error';
  lastSync: number | null;
  pendingChanges: number;
  conflictCount: number;
  syncMode: 'realtime' | 'polling';
  pollInterval: number;
  error?: string;
}

// 认证凭据
interface SyncCredentials {
  username: string;
  passwordHash: string;  // SHA-256 + salt 哈希
  deviceName: string;
  deviceType: DeviceType;
  platform: string;
}

// 同步结果
interface SyncResult {
  success: boolean;
  uploaded: number;
  downloaded: number;
  conflicts: number;
  errors: string[];
}

// 冲突信息
interface Conflict {
  id: string;
  docId: string;
  docType: 'event' | 'config';
  local: { value: unknown; timestamp: number; deviceId: string };
  remote: { value: unknown; timestamp: number; deviceId: string };
  resolved: boolean;
}
```

---

## 4. 实现设计

### 4.1 PouchSyncAdapter 核心流程

```
连接流程:
  connect(url, credentials)
    ↓
  1. 创建本地 PouchDB (local_{username})
    ↓
  2. 创建远程 PouchDB (url/database/{username})
    ↓
  3. 确保设计文档视图存在 (_design/sync)
    ↓
  4. 启动实时同步监听 (changes())
    ↓
  status = 'connected'

同步流程:
  syncEvents() / syncConfig()
    ↓
  1. 获取本地文档 (query 'sync/events' 或 'sync/configs')
    ↓
  2. 获取远程文档
    ↓
  3. 双向比较 + 合并
    ↓
  4. 上传/下载变更
    ↓
  更新 status.lastSync
```

### 4.2 实时同步机制

```typescript
// pouch-sync.ts

private startRealtimeSync(): void {
  // 监听本地变更 → 同步到远程
  this.localChangesListener = this.localDB!.changes({
    since: 'now',
    live: true,
    include_docs: true,
  });

  this.localChangesListener.on('change', async (change) => {
    if (change.id.startsWith('_') || change.deleted) return;

    const doc = await this.localDB!.get(change.id);
    await this.remoteDB!.put(doc);
    this.status.pendingChanges--;
  });

  // 监听远程变更 → 同步到本地
  this.remoteChangesListener = this.remoteDB!.changes({
    since: 'now',
    live: true,
    include_docs: true,
  });

  this.remoteChangesListener.on('change', async (change) => {
    if (change.id.startsWith('_') || change.deleted) return;

    const remoteDoc = await this.remoteDB!.get(change.id);
    await this.localDB!.put(remoteDoc);
  });

  this.status.syncMode = 'realtime';
}
```

### 4.3 双向同步策略

```typescript
// pouch-sync.ts

async syncEvents(): Promise<SyncResult> {
  // 获取本地和远程事件
  const localEvents = await this.getEvents(this.localDB!);
  const remoteEvents = await this.getEvents(this.remoteDB!);

  for (const event of localEvents) {
    const remote = remoteEvents.find(e => e.id === event.id);

    if (!remote) {
      // 本地有，远程没有 → 上传
      await this.remoteDB!.put(event);
      uploaded++;
    } else if (event.timestamp > remote.timestamp) {
      // 本地更新，更新远程
      await this.remoteDB!.put(event);
      uploaded++;
    }
  }

  for (const event of remoteEvents) {
    const local = localEvents.find(e => e.id === event.id);

    if (!local) {
      // 远程有，本地没有 → 下载
      await this.localDB!.put(event);
      downloaded++;
    } else if (event.timestamp > local.timestamp) {
      // 远程更新，更新本地
      await this.localDB!.put(event);
      downloaded++;
    }
  }

  this.status.lastSync = Date.now();
  return { success: true, uploaded, downloaded, conflicts: 0, errors: [] };
}
```

---

## 5. 数据结构

### 5.1 用户数据库结构

```
用户数据库: user-{username}.db

文档类型 1: 认证信息 (_local/users)  [仅本地，不同步]
├── _id: 'user:{username}'
├── passwordHash: string  # SHA-256 + salt
└── createdAt: ISO8601

文档类型 2: 事件  [同步]
├── _id: 'event:{uuid}'
├── type: 'event'
├── eventId: uuid
├── content: string
├── timestamp: ISO8601
├── tags: string[]
├── deviceId: uuid
├── _rev: string          # CouchDB 版本控制
└── _deleted: boolean

文档类型 3: 配置  [同步 - global 作用域]
├── _id: 'config:{key}'
├── type: 'config'
├── key: string
├── value: any
├── encrypted: boolean
├── deviceId: uuid
├── updatedAt: ISO8601
├── scope: 'global'
└── _rev: string
```

### 5.2 视图设计

```javascript
// _design/sync/views

{
  views: {
    events: {
      map: `function(doc) {
        if (doc.type === 'event') {
          emit(doc._id, doc);
        }
      }`
    },
    configs: {
      map: `function(doc) {
        if (doc.type === 'config' && doc.scope === 'global') {
          emit(doc._id, doc);
        }
      }`
    },
    conflicts: {
      map: `function(doc) {
        if (doc._conflicts && doc._conflicts.length > 0) {
          emit(doc._id, doc);
        }
      }`
    }
  }
}
```

---

## 6. 架构问题修复

### 6.1 问题描述

**问题**：类型重复定义

`pouch-sync.ts` 中定义了重复的类型（SyncStatus, SyncCredentials 等），违反 DRY 原则。

### 6.2 解决方案

**步骤 1**：删除 pouch-sync.ts 中的重复类型定义

```typescript
// BEFORE (pouch-sync.ts)
// 删除了以下重复定义：
// - interface SyncStatus
// - interface SyncCredentials
// - interface SyncResult
// - interface Conflict
// - interface ConfigDoc
// - interface ISyncPort

// AFTER (pouch-sync.ts)
// 复用 sync.port.ts 中的类型
import type {
  SyncStatus,
  SyncCredentials,
  SyncResult,
  Conflict,
  ConfigDoc,
  ISyncPort,
  DocType,
} from '@/environment/interfaces/sync.port';
```

**步骤 2**：确保类型兼容性

```typescript
// sync.port.ts 使用枚举
export enum DeviceType {
  PHONE = 'phone',
  TABLET = 'tablet',
  DESKTOP = 'desktop',
  SERVER = 'server',
}

// pouch-sync.ts 中使用字符串字面量
// 保持兼容，但优先使用枚举
const deviceType: DeviceType = DeviceType.DESKTOP;
```

---

## 7. 待集成功能

### 7.1 密码哈希集成

**当前状态**：`sync-store.ts` 中密码哈希是占位符实现

```typescript
// BEFORE (sync-store.ts:179)
// const passwordHash = password; // TODO: 使用 crypto.subtle.pbkdf2

// AFTER (集成 SPEC-302)
import { CryptoAdapter } from '@/adapters/crypto-adapter';

const crypto = new CryptoAdapter();
const salt = crypto.generateSalt(16);
const passwordHash = await crypto.hashPassword(password, salt);
```

### 7.2 冲突解决策略

**当前策略**：LWW（最后写入胜）

```typescript
// lib/sync/conflict-resolver.ts

export function resolveByLWW(local: DocWithRev, remote: DocWithRev): 'local' | 'remote' {
  if (local.timestamp > remote.timestamp) return 'local';
  if (local.timestamp < remote.timestamp) return 'remote';
  // 时间戳相同，比较设备 ID
  return local.deviceId > remote.deviceId ? 'local' : 'remote';
}
```

---

## 8. 测试用例

### 8.1 PouchSyncAdapter 测试

```typescript
// tests/sync/pouch-sync.test.ts

describe('PouchSyncAdapter', () => {
  let adapter: PouchSyncAdapter;

  beforeEach(() => {
    adapter = new PouchSyncAdapter();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe('connect/disconnect', () => {
    it('应该正确连接服务器', async () => {
      await adapter.connect('http://localhost:6984', {
        username: 'test',
        passwordHash: 'hash',
        deviceName: 'Test Device',
        deviceType: 'desktop',
        platform: 'Windows',
      });

      const status = adapter.getStatus();
      expect(status.state).toBe('connected');
    });

    it('应该正确断开连接', async () => {
      await adapter.connect('http://localhost:6984', credentials);
      await adapter.disconnect();

      const status = adapter.getStatus();
      expect(status.state).toBe('disconnected');
    });
  });

  describe('syncEvents', () => {
    it('应该同步事件数据', async () => {
      await adapter.connect('http://localhost:6984', credentials);
      const result = await adapter.syncEvents();

      expect(result.success).toBe(true);
      expect(typeof result.uploaded).toBe('number');
      expect(typeof result.downloaded).toBe('number');
    });
  });

  describe('getConflicts', () => {
    it('应该返回冲突列表', async () => {
      await adapter.connect('http://localhost:6984', credentials);
      const conflicts = await adapter.getConflicts();

      expect(Array.isArray(conflicts)).toBe(true);
    });
  });
});
```

---

## 9. 验收标准

### 9.1 功能验收

| 用例 | 验收条件 |
|------|----------|
| 连接服务器 | 输入正确 IP:端口 + 用户名密码，能连接成功 |
| 断开连接 | 点击断开，状态变为 disconnected |
| 同步事件 | 新增事件后点击同步，数据同步到服务器 |
| 同步配置 | 修改配置后同步，其他设备能看到更新 |
| 冲突检测 | 同时在两设备修改同一文档，检测到冲突 |
| 冲突解决 | 选择保留本地/远端后，冲突解决 |

### 9.2 架构验收

| 检查项 | 验收条件 |
|--------|----------|
| 类型复用 | pouch-sync.ts 复用 sync.port.ts 中的类型 |
| 接口一致 | sync-store.ts 通过 ISyncPort 接口使用 Adapter |
| 分层清晰 | L1/L2/L3/L4 职责分明 |

---

## 10. 依赖清单

### 10.1 前端依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| `pouchdb` | ^8.0.0 | 客户端数据库 |
| `pouchdb-adapter-memory` | ^8.0.0 | 内存适配器（测试用）|

### 10.2 服务端依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| `pouchdb` | ^8.0.0 | 服务端数据库 |
| `express` | ^4.18.0 | HTTP 服务 |
| `socket.io` | ^4.7.0 | WebSocket 服务 |
| `cors` | ^2.8.0 | 跨域中间件 |

---

## 11. 后续扩展

- [ ] 定时轮询模式（polling）
- [ ] 增量同步优化
- [ ] 同步历史记录
- [ ] 云端 CouchDB 支持

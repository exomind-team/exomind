# 多设备数据同步模块规格

> **合并自**: SPEC-301（多设备数据同步功能，68K）+ SPEC-303（sync 模块架构设计，19K）
>
> 本文档是 ExoMind 数据同步模块的权威规格，涵盖整体架构、接口设计、核心实现、服务端部署与验收标准。

---

## 1. 概述

### 1.1 功能描述

实现 ExoMind 的多设备数据同步功能，支持局域网内设备通过 PouchDB Server 进行数据同步。

### 1.2 核心目标

- **渐进式迁移**：保留现有 IStoragePort 接口，新增 ISyncPort 扩展
- **用户隔离**：每个用户独立数据库 (`user-{username}.db`)
- **实时同步**：WebSocket 优先，定时轮询可选
- **离线支持**：断网时本地 PouchDB 工作，联网自动同步
- **冲突检测**：LWW（最后写入胜）+ 冲突 UI 显示

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
│   ├── crypto-adapter.ts        # 加密实现
│   ├── pouch-sync.ts            # [已实现] PouchSyncAdapter
│   └── user-adapter.ts          # 用户认证适配器
│
├── environment/
│   └── interfaces/
│       ├── storage.port.ts     # 已有
│       ├── crypto.port.ts      # 加密 Port
│       └── sync.port.ts        # [已定义] ISyncPort 接口 + 类型
│
├── services/
│   ├── interfaces/
│   │   ├── sync.service.ts    # 同步服务接口
│   │   └── user.service.ts    # 用户服务接口
│   └── impl/
│       ├── sync.service.impl.ts
│       └── user.service.impl.ts
│
└── ui/
    ├── pages/
    │   ├── SyncTestPage.tsx    # 同步测试页面 (/sync-test)
    │   └── UserManagePage.tsx  # 用户管理页面 (/user-manage)
    └── stores/
        └── sync-store.ts       # [已实现] Zustand Store

server/
├── package.json                 # 依赖配置
├── config.js                    # 服务端配置
└── pouchdb-server.js            # PouchDB Server 入口 (端口: 6984)

tests/
└── sync/
    ├── sync.port.test.ts        # [待实现] ISyncPort 测试
    ├── conflict.test.ts         # [已存在] 冲突解决测试
    ├── import-export.test.ts    # 导入导出测试
    └── user.test.ts            # 用户管理测试
```

### 2.3 类型复用关系

```
sync.port.ts (L2 Port)
├── enum DeviceType
├── type SyncState / SyncMode / ConflictResolution / ImportStrategy / DocType / ConfigScope
├── interface SyncCredentials / SyncStatus / SyncResult / Conflict / ImportResult
├── interface DeviceInfo / ConfigDoc / SyncEvent
└── interface ISyncPort

         ↓ 复用

pouch-sync.ts (L1 Adapter)
├── class PouchSyncAdapter
└── 应复用 sync.port.ts 中的类型（已去重）

         ↓ 集成

sync-store.ts (L4/L3)
└── useSyncStore
```

---

## 3. 接口设计

### 3.1 ISyncPort 接口

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
export enum DeviceType {
  PHONE = 'phone',
  TABLET = 'tablet',
  DESKTOP = 'desktop',
  SERVER = 'server',
}

export interface SyncCredentials {
  username: string;
  passwordHash: string;  // SHA-256 + salt 哈希
  deviceName: string;
  deviceType: DeviceType;
  platform: string;
}

export interface SyncStatus {
  state: 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error';
  lastSync: number | null;
  pendingChanges: number;
  conflictCount: number;
  syncMode: 'realtime' | 'polling';
  pollInterval: number;
  error?: string;
}

export interface SyncResult {
  success: boolean;
  uploaded: number;
  downloaded: number;
  conflicts: number;
  errors: string[];
}

export interface Conflict {
  id: string;
  docId: string;
  docType: 'event' | 'config';
  local: { value: unknown; timestamp: number; deviceId: string };
  remote: { value: unknown; timestamp: number; deviceId: string };
  resolved: boolean;
}

export type ImportStrategy = 'merge' | 'skip' | 'overwrite';

export interface ImportResult {
  success: boolean;
  importedCount: number;
  skippedCount: number;
  conflictCount: number;
  errors: string[];
}
```

---

## 4. 数据结构设计

### 4.1 用户数据库结构

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
├── scope: 'global' | 'local'
└── _rev: string

文档类型 4: 设备信息  [仅本地，不同步，使用 localStorage]
├── _id: 'device:{deviceId}'
├── deviceName: string
├── deviceType: DeviceType
├── platform: string
├── lastSync: ISO8601
└── createdAt: ISO8601
```

#### 配置作用域说明

| 作用域 | 键名示例 | 是否同步 | 说明 |
|--------|---------|---------|------|
| global | theme, shortcuts, api:* | 同步 | 通用配置，所有设备共享 |
| local | voice.language, voice.autoSend | 不同步 | 设备本地配置 |

### 4.2 视图设计

```javascript
// _design/sync/views
{
  views: {
    events: {
      map: `function(doc) {
        if (doc.type === 'event') { emit(doc._id, doc); }
      }`
    },
    configs: {
      map: `function(doc) {
        if (doc.type === 'config' && doc.scope === 'global') { emit(doc._id, doc); }
      }`
    },
    conflicts: {
      map: `function(doc) {
        if (doc._conflicts && doc._conflicts.length > 0) { emit(doc._id, doc); }
      }`
    }
  }
}
```

---

## 5. 核心实现

### 5.1 设备管理

```typescript
// src/lib/sync/device-manager.ts

const DEVICE_ID_KEY = 'exomind:deviceId';
const DEVICE_INFO_KEY = 'exomind:deviceInfo';

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  platform: string;
  createdAt: number;
}

export function getDeviceId(): string { /* UUID 生成/缓存 */ }
export function getDeviceInfo(): DeviceInfo | null { /* localStorage 读取 */ }
export function saveDeviceInfo(info: DeviceInfo): void { /* localStorage 写入 */ }
export function initDevice(name: string, type: DeviceType, platform: string): DeviceInfo { /* 初始化 */ }
export function detectDeviceType(): DeviceType { /* UA 检测 */ }
export function detectPlatform(): string { /* 平台检测 */ }
```

### 5.2 AES-256 加密（密钥随密码生成，支持多设备同步）

```typescript
// src/adapters/crypto-adapter.ts

const ENCRYPTION_SALT = 'exomind-v1-salt';  // 固定公开盐

// 使用 PBKDF2 从密码派生 AES-256 密钥
export async function deriveKeyFromPassword(password: string): Promise<CryptoKey>;
export async function encryptAes256(plaintext: string, password: string): Promise<string>;
export async function decryptAes256(ciphertext: string, password: string): Promise<string>;

export class CryptoAdapter implements ICryptoPort {
  async setPassword(password: string): Promise<void>;
  async encrypt(plaintext: string): Promise<string>;
  async decrypt(ciphertext: string): Promise<string>;
  deriveKeyFromPassword(password: string): Promise<CryptoKey>;
}
```

### 5.3 PouchSyncAdapter 核心流程

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

### 5.4 实时同步机制

```typescript
private startRealtimeSync(): void {
  // 监听本地变更 → 同步到远程
  this.localDB.changes({ since: 'now', live: true, include_docs: true })
    .on('change', async (change) => {
      if (change.id.startsWith('_') || change.deleted) return;
      const doc = await this.localDB!.get(change.id);
      await this.remoteDB!.put(doc);
      this.status.pendingChanges--;
    });

  // 监听远程变更 → 同步到本地
  this.remoteDB.changes({ since: 'now', live: true, include_docs: true })
    .on('change', async (change) => {
      if (change.id.startsWith('_') || change.deleted) return;
      const remoteDoc = await this.remoteDB!.get(change.id);
      await this.localDB!.put(remoteDoc);
    });

  this.status.syncMode = 'realtime';
}
```

### 5.5 双向同步策略

```typescript
async syncEvents(): Promise<SyncResult> {
  const localEvents = await this.getEvents(this.localDB!);
  const remoteEvents = await this.getEvents(this.remoteDB!);

  // 本地有远程无 → 上传；本地更新 → 上传
  // 远程有本地无 → 下载；远程更新 → 下载

  this.status.lastSync = Date.now();
  return { success: true, uploaded, downloaded, conflicts: 0, errors: [] };
}
```

### 5.6 冲突解决

```typescript
// src/lib/sync/conflict-resolver.ts

export function resolveByLWW(local: DocWithRev, remote: DocWithRev): 'local' | 'remote' {
  if (local.timestamp > remote.timestamp) return 'local';
  if (local.timestamp < remote.timestamp) return 'remote';
  return local.deviceId > remote.deviceId ? 'local' : 'remote';
}

export function detectConflict(local: DocWithRev, remote: DocWithRev): boolean;
export function createConflict(docId: string, docType: 'event' | 'config', local: DocWithRev, remote: DocWithRev): Conflict;
```

### 5.7 用户管理接口

```typescript
// src/lib/ports/user.port.ts

export interface IUserPort {
  register(username: string, password: string): Promise<void>;
  login(username: string, password: string): Promise<UserSession>;
  logout(): Promise<void>;
  switchUser(username: string): Promise<void>;
  getCurrentUser(): UserSession | null;
  getLoggedInUsers(): UserSession[];
  removeUser(username: string): Promise<void>;
}

export interface UserSession {
  username: string;
  deviceName: string;
  deviceId: string;
  token: string;
  lastLogin: number;
}
```

---

## 6. 后端服务

### 6.1 PouchDB Server

```javascript
// server/pouchdb-server.js
// 技术栈: Express + PouchDB + Socket.IO
// 端口: 6984（默认，避免与 CouchDB 5984 冲突）
// 数据目录: ./data/user-{username}.db/

// 核心功能:
// - POST /register    用户注册（PBKDF2 加盐哈希）
// - POST /login       用户登录（返回 Bearer Token）
// - /db/:username/*   认证中间件保护的数据库 API
// - WebSocket 变化广播（Socket.IO room per user）
```

### 6.2 配置

```javascript
// server/config.js
export default {
  port: 6984,
  dataDir: './data',
  corsOrigin: '*',
  pollingInterval: 300000,
};
```

### 6.3 启动命令

```bash
# 开发模式
node server/pouchdb-server.js

# 环境变量
EXOMIND_POUCHDB_HOST=0.0.0.0 EXOMIND_POUCHDB_PORT=6984 node server/pouchdb-server.js
```

### 6.4 网络配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 端口 | **6984** | TCP（默认） |
| 协议 | HTTP + WebSocket | `http://` 和 `ws://` |
| 认证 | Bearer Token | 请求头传递 |
| CORS | `*` | 开发环境可放宽 |
| 防火墙 | 开放 6984 | 允许局域网访问 |

---

## 7. 架构问题修复

### 7.1 类型重复定义

**问题**：`pouch-sync.ts` 中定义了重复的类型（SyncStatus, SyncCredentials 等），违反 DRY 原则。

**解决方案**：删除 pouch-sync.ts 中的重复类型定义，复用 sync.port.ts 中的类型。

```typescript
// AFTER (pouch-sync.ts)
import type {
  SyncStatus, SyncCredentials, SyncResult, Conflict,
  ConfigDoc, ISyncPort, DocType,
} from '@/environment/interfaces/sync.port';
```

### 7.2 密码哈希集成

```typescript
// sync-store.ts 中密码哈希占位符 → 集成 CryptoAdapter
import { CryptoAdapter } from '@/adapters/crypto-adapter';

const crypto = new CryptoAdapter();
const salt = crypto.generateSalt(16);
const passwordHash = await crypto.hashPassword(password, salt);
```

---

## 8. 测试用例

### 8.1 冲突解决测试

```typescript
describe('冲突解决', () => {
  it('应该选择时间戳更新的版本');
  it('时间戳相同时选择设备ID更大的');
  it('应该正确检测冲突');
  it('相同设备不应有冲突');
});
```

### 8.2 PouchSyncAdapter 测试

```typescript
describe('PouchSyncAdapter', () => {
  describe('connect/disconnect', () => {
    it('应该正确连接服务器');
    it('应该正确断开连接');
  });
  describe('syncEvents', () => {
    it('应该同步事件数据');
  });
  describe('getConflicts', () => {
    it('应该返回冲突列表');
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
| 导入数据 | 从 localStorage 导入，数据正确合并 |
| 导出数据 | 导出为 JSONL 文件 |
| 冲突检测 | 同时在两设备修改同一文档，检测到冲突 |
| 冲突解决 | 选择保留本地/远端后，冲突解决 |

### 9.2 性能验收

| 指标 | 目标 |
|------|------|
| 首次同步 1000 条事件 | < 5 秒 |
| 增量同步 10 条事件 | < 500ms |
| 冲突检测 | < 100ms |
| 页面加载 | < 1 秒 |

### 9.3 安全验收

| 检查项 | 验收条件 |
|--------|----------|
| 密码传输 | HTTPS/WSS 加密传输 |
| 密码存储 | 仅本地哈希，不传明文 |
| API Key | AES-256 加密存储 |
| 用户隔离 | 不同用户数据库隔离 |

### 9.4 架构验收

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
| `socket.io-client` | ^4.7.0 | WebSocket 客户端 |

### 10.2 服务端依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| `pouchdb` | ^8.0.0 | 服务端数据库 |
| `express` | ^4.18.0 | HTTP 服务 |
| `socket.io` | ^4.7.0 | WebSocket 服务 |
| `cors` | ^2.8.0 | 跨域中间件 |

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 局域网不稳定 | 同步失败 | 重试机制 + 离线缓存 |
| 密码泄露 | 数据泄露 | 仅本地哈希，HTTPS |
| 冲突复杂 | 数据丢失 | LWW + 冲突 UI |
| 大量数据 | 同步慢 | 分页同步 + 增量更新 |

---

## 12. 后续扩展

- [ ] 定时轮询模式（polling）
- [ ] 增量同步优化
- [ ] 同步历史记录
- [ ] 云端 CouchDB 支持（替换 PouchDB Server）
- [ ] 端到端加密（E2EE）
- [ ] 多设备会话管理
- [ ] 同步历史回滚

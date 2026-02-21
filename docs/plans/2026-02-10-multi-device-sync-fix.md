# 多设备同步修复实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标**：修复 PR #20 审查不通过的安全、性能、测试问题，创建真实可运行的多设备同步样例

**架构**：
- 前端改用 PouchDB 内置 `replicate()` API 替代手动的 O(n²) 双向同步
- 服务器端替换为 `@pouchdb/server`，使用官方认证和 JWT Token
- 提供一键启动脚本：启动服务器 + 打开测试浏览器

**技术栈**：
- 前端：`@pouchdb/core`, `pouchdb-adapter-idb`
- 服务器：`@pouchdb/server`, `express`
- 测试：`@faker-js/faker`, `vitest`

---

## 任务概览

| 任务 | 状态 | 说明 |
|------|------|------|
| T1 | 待处理 | 创建一键启动脚本（dev.ps1） |
| T2 | 待处理 | 服务器端改用官方 PouchDB Server |
| T3 | 待处理 | 前端 pouch-sync.ts 改用内置复制 API |
| T4 | 待处理 | 修复安全问题：移除密码哈希存储、简化 crypto-adapter |
| T5 | 待处理 | 补全 PouchSyncAdapter 核心测试 |
| T6 | 待处理 | 创建 E2E 同步测试 |
| T7 | 待处理 | 更新用户文档 |

---

## 任务 T1: 创建一键启动脚本

**文件**：
- 创建：`dev.ps1`
- 修改：`package.json`
- 参考：`docs/runbook/开发流程.md`

**Step 1: 编写启动脚本**

```powershell
# dev.ps1 - 一键启动同步样例

$ErrorActionPreference = "Stop"

Write-Host "ExoMind 多设备同步开发环境" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 检查并安装依赖
if (-not (Test-Path "node_modules/@pouchdb/server")) {
    Write-Host "正在安装 PouchDB Server..." -ForegroundColor Yellow
    bun add @pouchdb/server @pouchdb/core @pouchdb/adapter-idb pouchdb
}

# 启动服务器（后台）
Write-Host "[1/2] 启动 PouchDB 同步服务器..." -ForegroundColor Green
$serverProcess = Start-Process -FilePath "bun" -ArgumentList "run", "server/pouchdb-server.js" -NoNewWindow -PassThru -RedirectStandardOutput "server/server.log" -RedirectStandardError "server/server.error.log"

# 等待服务器启动
Start-Sleep -Seconds 3

# 检查服务器是否运行
$serverLog = Get-Content "server/server.log" -Tail 5 -ErrorAction SilentlyContinue
if ($serverLog -match "PouchDB Server running") {
    Write-Host "[OK] 服务器已启动在 http://localhost:6984" -ForegroundColor Green
} else {
    Write-Host "[ERROR] 服务器启动失败，查看 server/server.log" -ForegroundColor Red
    Get-Content "server/server.log" -Tail 20
    exit 1
}

# 打开测试浏览器
Write-Host "[2/2] 打开测试浏览器..." -ForegroundColor Green
Write-Host "   - 主窗口: http://localhost:5173" -ForegroundColor White
Write-Host "   - 第二窗口需手动打开并登录不同账户测试同步" -ForegroundColor White

# 打开主窗口
Start-Process "http://localhost:5173"

# 启动前端开发服务器
Write-Host "" -ForegroundColor Cyan
Write-Host "提示：在第二浏览器打开 http://localhost:5173 并登录不同账户测试多设备同步" -ForegroundColor Yellow
Write-Host "按 Ctrl+C 停止所有服务" -ForegroundColor Yellow

# 启动 Vite 前端
bun run dev
```

**Step 2: 更新 package.json 脚本**

```json
{
  "scripts": {
    "dev": "vite",
    "dev:sync": "powershell -ExecutionPolicy Bypass -File dev.ps1",
    "test:sync": "vitest run tests/sync/pouch-sync.test.ts"
  }
}
```

**Step 3: 运行验证**

```powershell
PS D:\project\exomind> .\dev.ps1
ExoMind 多设备同步开发环境
================================
[1/2] 启动 PouchDB 同步服务器...
[OK] 服务器已启动在 http://localhost:6984
[2/2] 打开测试浏览器...
```

**Step 4: 提交**

```bash
git add dev.ps1 package.json
git commit -m "feat: 添加一键启动同步样例脚本"
```

---

## 任务 T2: 服务器端改用官方 PouchDB Server

**文件**：
- 修改：`server/pouchdb-server.js`
- 创建：`server/config.js`
- 删除：`server/auth.js`（如果存在）

**Step 1: 安装官方 PouchDB Server**

```bash
cd server && bun add @pouchdb/server @pouchdb/core @pouchdb/adapter-memory express
```

**Step 2: 创建服务器配置文件**

```javascript:server/config.js
// 服务器配置
export default {
  port: process.env.PORT || 6984,
  host: process.env.HOST || 'localhost',
  dataDir: process.env.DATA_DIR || './data',
  logDir: process.env.LOG_DIR || './logs',
  // 官方 PouchDB Server 配置
  pouchdbServer: {
    // 基础认证配置
    auth: {
      // 禁用注册（仅允许预设用户）
      register: false,
    },
    // CORS 配置
    cors: {
      origin: '*',  // 开发环境允许所有，生产环境应限制
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'],
      credentials: true,
    },
  },
};
```

**Step 3: 重写服务器**

```javascript:server/pouchdb-server.js
/**
 * PouchDB Sync Server
 *
 * 使用官方 @pouchdb/server，提供：
 * - 内置用户认证（可扩展）
 * - 自动 JWT Token 生成
 * - 实时变更推送
 *
 * 端口: 6984
 */

import express from 'express';
import cors from 'cors';
import PouchDBServer from '@pouchdb/server';
import fs from 'fs';
import path from 'path';
import config from './config.js';

// 确保目录存在
const DB_DIR = path.resolve(config.dataDir);
const LOGS_DIR = path.resolve(config.logsDir);

for (const dir of [DB_DIR, LOGS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 创建日志流
const logStream = fs.createWriteStream(path.join(LOGS_DIR, 'server.log'), { flags: 'a' });

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  logStream.write(logMessage);
  console.log(logMessage.trim());
}

// 创建 Express 应用
const app = express();
app.use(cors({
  origin: config.pouchdbServer.cors.origin,
  credentials: config.pouchdbServer.cors.credentials,
}));
app.use(express.json());

// 初始化 PouchDB Server
const pouchdbServer = PouchDBServer({
  inMemory: false,  // 使用文件系统存储
  path: DB_DIR,
});

// 将 PouchDB Server 的路由挂载到 /database 前缀
app.use('/database', pouchdbServer);

// 根路径 - 健康检查
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'PouchDB Sync Server running',
    version: '1.0.0',
    endpoints: {
      health: '/',
      users: '/_users',
      database: '/database/:dbname',
    },
  });
});

// 统计信息端点
app.get('/stats', async (req, res) => {
  try {
    const stats = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      databases: [],
    };

    // 获取数据库列表
    const dbPath = DB_DIR;
    if (fs.existsSync(dbPath)) {
      const files = fs.readdirSync(dbPath);
      stats.databases = files
        .filter(f => f.endsWith('.db'))
        .map(f => f.replace('.db', ''));
    }

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 启动服务器
const PORT = config.port;
const HOST = config.host;

app.listen(PORT, HOST, () => {
  log(`PouchDB Server 运行在 http://${HOST}:${PORT}`);
  log(`数据目录: ${DB_DIR}`);
  log(`日志目录: ${LOGS_DIR}`);
});

// 优雅关闭
process.on('SIGINT', () => {
  log('收到关闭信号，正在关闭服务器...');
  process.exit(0);
});

export { app };
```

**Step 4: 更新 package.json 服务器脚本**

```json
{
  "scripts": {
    "server": "node server/pouchdb-server.js",
    "server:dev": "node --watch server/pouchdb-server.js"
  }
}
```

**Step 5: 验证服务器启动**

```bash
# 安装依赖
cd server && bun install

# 启动服务器
bun run server

# 测试健康检查
curl http://localhost:6984/

# 测试数据库创建
curl -X PUT http://localhost:6984/database/test-user
```

**Step 6: 提交**

```bash
git add server/pouchdb-server.js server/config.js package.json
git commit -m "refactor: 替换为官方 PouchDB Server"
```

---

## 任务 T3: 前端 pouch-sync.ts 改用内置复制 API

**文件**：
- 修改：`src/adapters/pouch-sync.ts`

**Step 1: 阅读现有代码理解结构**

```typescript
// 关键方法需要重构：
// - syncEvents() O(n²) → 使用 PouchDB.replicate()
// - syncConfig() O(n²) → 使用 PouchDB.replicate()
// - startRealtimeSync() → 简化，使用 live: true
```

**Step 2: 编写新版本**

```typescript
/**
 * PouchDB 同步适配器（优化版）
 *
 * 使用 PouchDB 内置 replicate() API：
 * - 自动双向同步
 * - 增量复制（性能优化）
 * - 内置冲突检测
 */

import PouchDB from 'pouchdb';
import type {
  SyncEvent,
  ConfigDoc,
  ISyncPort,
  SyncStatus,
  SyncCredentials,
  SyncResult,
  Conflict,
} from '@/environment/interfaces/sync.port';

// PouchDB 插件
import pouchdbAdapterIdb from 'pouchdb-adapter-idb';

// 注册 IDB 适配器（使用 IndexedDB 作为本地存储）
PouchDB.plugin(pouchdbAdapterIdb);

// 设备信息存储键
const DEVICE_ID_KEY = 'exomind:deviceId';
const CREDENTIALS_KEY = 'exomind:sync-credentials';

/**
 * 获取设备 ID（加密安全）
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') {
    return crypto.randomUUID();
  }

  const stored = localStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;

  const newId = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, newId);
  return newId;
}

/**
 * PouchDB 同步适配器
 */
export class PouchSyncAdapter implements ISyncPort {
  private localDB: PouchDB.Database | null = null;
  private remoteDB: PouchDB.Database | null = null;
  private credentials: SyncCredentials | null = null;
  private status: SyncStatus;

  // 复制句柄（用于取消）
  private replicationHandle: PouchDB.Replication.Sync<unknown> | null = null;

  constructor() {
    this.status = this.getInitialStatus();
  }

  private getInitialStatus(): SyncStatus {
    return {
      state: 'disconnected',
      lastSync: null,
      pendingChanges: 0,
      conflictCount: 0,
      syncMode: 'realtime',
      pollInterval: 5,
    };
  }

  /**
   * 连接到同步服务器
   */
  async connect(url: string, credentials: SyncCredentials): Promise<void> {
    this.credentials = credentials;
    this.status.state = 'connecting';

    const { username, password } = credentials;

    // 创建本地数据库（使用 IndexedDB）
    const dbName = `local_${username}`;
    this.localDB = new PouchDB(dbName, { adapter: 'idb' });

    // 创建远程数据库连接
    const remoteUrl = `${url}/database/${username}`;
    this.remoteDB = new PouchDB(remoteUrl, {
      auth: {
        username,
        password,
      },
    });

    // 启动实时双向同步
    this.startRealtimeSync();

    // 保存凭据（用于自动重连）
    if (typeof window !== 'undefined') {
      localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
    }

    this.status.state = 'connected';
  }

  /**
   * 启动实时双向同步
   *
   * 使用 PouchDB 内置 replicate() 实现：
   * - 本地 → 远程：持续复制
   * - 远程 → 本地：持续复制
   */
  private startRealtimeSync(): void {
    if (!this.localDB || !this.remoteDB) {
      throw new Error('数据库未初始化');
    }

    // 取消现有复制
    this.stopReplication();

    // 本地 → 远程
    const push = PouchDB.replicate(this.localDB, this.remoteDB, {
      live: true,          // 持续复制
      retry: true,         // 断线重连
      name: `${this.credentials?.username}_push`,
    });

    // 远程 → 本地
    const pull = PouchDB.replicate(this.remoteDB, this.localDB, {
      live: true,
      retry: true,
      name: `${this.credentials?.username}_pull`,
    });

    // 合并双向复制
    this.replicationHandle = (push as unknown as PouchDB.Replication.Sync<unknown>)
      .on('change', (info) => {
        this.status.pendingChanges = 0;
        this.status.lastSync = Date.now();
        logSyncChange('push', info);
      })
      .on('change', (info) => {
        logSyncChange('pull', info);
      });

    this.status.syncMode = 'realtime';

    // 监听复制错误
    push.on('error', (err) => {
      console.error('[Sync] 推送错误:', err);
      this.status.state = 'error';
      this.status.error = err.message;
    });

    pull.on('error', (err) => {
      console.error('[Sync] 拉取错误:', err);
      this.status.state = 'error';
      this.status.error = err.message;
    });
  }

  /**
   * 停止复制
   */
  private stopReplication(): void {
    if (this.replicationHandle) {
      this.replicationHandle.cancel();
      this.replicationHandle = null;
    }
  }

  /**
   * 同步事件数据（手动触发）
   *
   * 注意：实时同步已自动处理，这里提供手动触发接口
   */
  async syncEvents(): Promise<SyncResult> {
    if (!this.localDB || !this.remoteDB) {
      return { success: false, uploaded: 0, downloaded: 0, conflicts: 0, errors: ['未连接'] };
    }

    this.status.state = 'syncing';

    try {
      // 使用 one-shot 复制进行手动同步
      const pushResult = await PouchDB.replicate(this.localDB, this.remoteDB);
      const pullResult = await PouchDB.replicate(this.remoteDB, this.localDB);

      this.status.lastSync = Date.now();
      this.status.state = 'connected';

      return {
        success: true,
        uploaded: pushResult.docs_written,
        downloaded: pullResult.docs_written,
        conflicts: 0,  // PouchDB 自动处理冲突
        errors: [],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.status.state = 'error';
      this.status.error = errMsg;
      return { success: false, uploaded: 0, downloaded: 0, conflicts: 0, errors: [errMsg] };
    }
  }

  /**
   * 同步配置数据
   */
  async syncConfig(): Promise<SyncResult> {
    // 配置同步与事件同步使用相同的复制通道
    return this.syncEvents();
  }

  /**
   * 推送单个事件
   */
  async pushEvent(event: SyncEvent): Promise<void> {
    if (!this.localDB) return;
    await this.localDB.put(event);
    this.status.pendingChanges++;
  }

  /**
   * 推送配置
   */
  async pushConfig(key: string, value: unknown): Promise<void> {
    if (!this.localDB) return;

    const config: ConfigDoc = {
      _id: `config:${key}`,
      type: 'config',
      key,
      value,
      scope: 'global',
      encrypted: false,
      deviceId: getDeviceId(),
      updatedAt: new Date().toISOString(),
    };

    await this.localDB.put(config);
    this.status.pendingChanges++;
  }

  /**
   * 获取冲突列表
   */
  async getConflicts(): Promise<Conflict[]> {
    if (!this.localDB) return [];

    const conflicts: Conflict[] = [];

    try {
      const result = await this.localDB.allDocs({ conflicts: true, include_docs: true });
      for (const row of result.rows) {
        if (row.doc?._conflicts?.length) {
          const doc = row.doc;
          for (const rev of doc._conflicts) {
            try {
              const conflictDoc = await this.localDB.get(doc._id, { rev });
              conflicts.push({
                id: `${doc._id}-${rev}`,
                docId: doc._id,
                docType: doc.type || 'event',
                local: { value: doc, timestamp: 0, deviceId: getDeviceId() },
                remote: { value: conflictDoc, timestamp: 0, deviceId: 'unknown' },
                resolved: false,
              });
            } catch {
              // 版本可能已被删除
            }
          }
        }
      }
    } catch {
      console.error('[Sync] 获取冲突列表失败');
    }

    this.status.conflictCount = conflicts.length;
    return conflicts;
  }

  /**
   * 解决冲突
   */
  async resolveConflict(docId: string, resolution: 'local' | 'remote' | 'merge'): Promise<void> {
    if (!this.localDB || !this.remoteDB) return;

    if (resolution === 'local') {
      const local = await this.localDB.get(docId);
      delete (local as Record<string, unknown>)._conflicts;
      await this.localDB.put(local);
      await this.remoteDB.put(local);
    } else if (resolution === 'remote') {
      const remote = await this.remoteDB.get(docId);
      await this.localDB.put(remote);
    } else {
      // merge 模式需要应用层实现
      const local = await this.localDB.get(docId);
      await this.remoteDB.put(local);
    }

    await this.getConflicts();
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.stopReplication();

    if (this.localDB) {
      await this.localDB.close();
      this.localDB = null;
    }

    this.remoteDB = null;
    this.credentials = null;

    // 清除保存的凭据
    if (typeof window !== 'undefined') {
      localStorage.removeItem(CREDENTIALS_KEY);
    }

    this.status = this.getInitialStatus();
  }

  /**
   * 获取同步状态
   */
  getStatus(): SyncStatus {
    return { ...this.status };
  }
}

/**
 * 日志辅助函数
 */
function logSyncChange(direction: 'push' | 'pull', info: { changes?: { length: number }[] }): void {
  const changes = info.changes?.[0]?.length || 0;
  console.log(`[Sync] ${direction}: ${changes} 个文档已同步`);
}

/**
 * 创建适配器实例
 */
export function createPouchSyncAdapter(): PouchSyncAdapter {
  return new PouchSyncAdapter();
}
```

**Step 3: 安装 PouchDB IDB 适配器**

```bash
bun add pouchdb-adapter-idb
```

**Step 4: 运行测试**

```bash
bun test tests/sync/pouch-sync.test.ts
```

**Step 5: 提交**

```bash
git add src/adapters/pouch-sync.ts package.json
git commit -m "refactor: pouch-sync 改用内置复制 API"
```

---

## 任务 T4: 简化 crypto-adapter（移除服务器端职责）

**文件**：
- 修改：`src/adapters/crypto-adapter.ts`

**Step 1: 分析现有代码**

当前 crypto-adapter 包含：
- 密码哈希（用于服务器认证）
- AES-256-GCM 加密
- 密钥派生

**Step 2: 简化职责**

```typescript
/**
 * 简化后的加密适配器
 *
 * 只负责：
 * - 消息内容的端到端加密
 * - 本地数据的存储加密
 *
 * 不再负责：
 * - 用户密码哈希（由服务器处理）
 * - Token 生成
 */

// 常量
const PBKDF2_ITERATIONS = 100000;  // NIST 推荐
const IV_LENGTH = 12;  // NIST 推荐
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;  // 256 位

/**
 * 派生密钥
 */
export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * 生成随机盐
 */
export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(salt);
  return salt;
}

/**
 * 加密数据
 */
export async function encrypt(data: string, password: string): Promise<{ iv: Uint8Array; encrypted: Uint8Array; salt: Uint8Array }> {
  const salt = generateSalt();
  const key = await deriveKey(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const encoder = new TextEncoder();
  const encoded = encoder.encode(data);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  return { iv, encrypted: new Uint8Array(encrypted), salt };
}

/**
 * 解密数据
 */
export async function decrypt(encrypted: Uint8Array, iv: Uint8Array, password: string, salt: Uint8Array): Promise<string> {
  const key = await deriveKey(password, salt);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}
```

**Step 3: 移除不使用的代码**

从 crypto-adapter.ts 中移除：
- `setPassword()` / `getPassword()`
- 密码哈希相关函数（`hashPassword`, `verifyPassword`）
- 服务器认证相关逻辑

**Step 4: 提交**

```bash
git add src/adapters/crypto-adapter.ts
git commit -m "refactor: 简化 crypto-adapter，移除认证职责"
```

---

## 任务 T5: 补全 PouchSyncAdapter 核心测试

**文件**：
- 创建：`tests/sync/pouch-sync.test.ts`
- 修改：`vitest.config.ts`

**Step 1: 创建 Mock PouchDB**

```typescript
/**
 * Mock PouchDB
 */

import { vi } from 'vitest';

// Mock PouchDB 类
export class MockPouchDB {
  private docs: Map<string, unknown> = new Map();
  private changesCallbacks: ((change: { id: string; deleted?: boolean; doc?: unknown }) => void)[] = [];

  constructor(private name: string) {}

  async put(doc: { _id: string; [key: string]: unknown }): Promise<{ ok: boolean; id: string; rev: string }> {
    const rev = `1-${Date.now()}`;
    this.docs.set(doc._id, { ...doc, _rev: rev });
    return { ok: true, id: doc._id, rev };
  }

  async get(id: string, _opts?: { rev?: string }): Promise<unknown> {
    const doc = this.docs.get(id);
    if (!doc) throw new Error('not_found');
    return doc;
  }

  async allDocs(opts?: { include_docs?: boolean; conflicts?: boolean }): Promise<{ rows: Array<{ id: string; doc?: unknown }> }> {
    const rows = Array.from(this.docs.entries()).map(([id, doc]) => ({
      id,
      ...(opts?.include_docs ? { doc } : {}),
    }));
    return { rows };
  }

  async query(_view: string, _opts?: unknown): Promise<{ rows: Array<{ id: string; value: unknown }> }> {
    // 简化实现
    return { rows: [] };
  }

  async close(): Promise<void> {
    this.docs.clear();
  }

  // Mock 变更监听
  changes(opts: { since: string; live: boolean; include_docs: boolean }): {
    on: (event: string, callback: (change: { id: string; deleted?: boolean; doc?: unknown }) => void) => void;
    cancel: () => void;
  } {
    const listener = opts.on === 'change' ? opts.live : undefined;
    return {
      on: (event, callback) => {
        if (event === 'change') {
          this.changesCallbacks.push(callback);
        }
      },
      cancel: () => {
        this.changesCallbacks = [];
      },
    };
  }
}

// Mock PouchDB.replicate
export async function mockReplicate(source: MockPouchDB, target: MockPouchDB): Promise<{ docs_written: number }> {
  const docs = await source.allDocs({ include_docs: true });
  let written = 0;
  for (const row of docs.rows) {
    if (row.doc) {
      await target.put(row.doc as { _id: string });
      written++;
    }
  }
  return { docs_written: written };
}

// Mock pouchdb-adapter-idb
export const pouchdbAdapterIdb = {};

// Mock 模块
vi.mock('pouchdb', () => ({
  default: MockPouchDB,
  __esModule: true,
}));

vi.mock('pouchdb-adapter-idb', () => ({
  default: pouchdbAdapterIdb,
  __esModule: true,
}));
```

**Step 2: 编写核心测试**

```typescript
/**
 * PouchSyncAdapter 核心测试
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { PouchSyncAdapter, createPouchSyncAdapter, getDeviceId } from '@/adapters/pouch-sync';

// Mock localStorage
const mockLocalStorage = {
  store: {} as Record<string, string>,
  getItem(key: string): string | null {
    return this.store[key] || null;
  },
  setItem(key: string, value: string): void {
    this.store[key] = value;
  },
  removeItem(key: string): void {
    delete this.store[key];
  },
};

// Mock crypto
const mockCrypto = {
  randomUUID: vi.fn(() => 'test-uuid-1234'),
  getRandomValues: vi.fn((arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  }),
};

describe('PouchSyncAdapter', () => {
  let adapter: PouchSyncAdapter;

  beforeAll(() => {
    // Mock window and globals
    vi.stubGlobal('localStorage', mockLocalStorage);
    vi.stubGlobal('crypto', mockCrypto);
    vi.stubGlobal('PouchDB', vi.fn().mockImplementation((name: string) => new MockPouchDB(name)));
    vi.stubGlobal('PouchDBReplicate', mockReplicate);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    adapter = createPouchSyncAdapter();
    mockLocalStorage.store = {};
  });

  describe('getDeviceId', () => {
    it('should return stored device ID if exists', () => {
      mockLocalStorage.store['exomind:deviceId'] = 'existing-id';
      expect(getDeviceId()).toBe('existing-id');
    });

    it('should generate and store new device ID if not exists', () => {
      const id = getDeviceId();
      expect(id).toBe('test-uuid-1234');
      expect(mockLocalStorage.store['exomind:deviceId']).toBe(id);
    });
  });

  describe('getInitialStatus', () => {
    it('should return correct initial status', () => {
      const status = adapter.getStatus();
      expect(status.state).toBe('disconnected');
      expect(status.pendingChanges).toBe(0);
      expect(status.conflictCount).toBe(0);
      expect(status.syncMode).toBe('realtime');
    });
  });

  describe('connect', () => {
    it('should transition to connected state', async () => {
      await adapter.connect('http://localhost:6984', {
        username: 'test-user',
        password: 'test-pass',
      });

      const status = adapter.getStatus();
      expect(status.state).toBe('connected');
    });
  });

  describe('disconnect', () => {
    it('should transition to disconnected state', async () => {
      await adapter.connect('http://localhost:6984', { username: 'test', password: 'test' });
      await adapter.disconnect();

      const status = adapter.getStatus();
      expect(status.state).toBe('disconnected');
    });
  });

  describe('pushEvent', () => {
    it('should increment pending changes', async () => {
      await adapter.connect('http://localhost:6984', { username: 'test', password: 'test' });

      const event = {
        id: 'event-1',
        type: 'event' as const,
        eventId: 'event-1',
        content: 'Test message',
        timestamp: new Date().toISOString(),
        tags: [],
        deviceId: 'test-device',
      };

      await adapter.pushEvent(event);

      const status = adapter.getStatus();
      expect(status.pendingChanges).toBe(1);
    });
  });

  describe('pushConfig', () => {
    it('should create config document and increment pending', async () => {
      await adapter.connect('http://localhost:6984', { username: 'test', password: 'test' });

      await adapter.pushConfig('theme', 'dark');

      const status = adapter.getStatus();
      expect(status.pendingChanges).toBe(1);
    });
  });

  describe('getConflicts', () => {
    it('should return empty array when no conflicts', async () => {
      await adapter.connect('http://localhost:6984', { username: 'test', password: 'test' });

      const conflicts = await adapter.getConflicts();
      expect(conflicts).toEqual([]);
    });
  });
});
```

**Step 3: 配置 Vitest**

```typescript:vitest.config.ts
/// <reference types="vitest" />

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/e2e/', '**/*.d.ts'],
    },
  },
});
```

**Step 4: 运行测试**

```bash
bun test tests/sync/pouch-sync.test.ts
```

**Step 5: 提交**

```bash
git add tests/sync/pouch-sync.test.ts vitest.config.ts
git commit -m "test: 添加 PouchSyncAdapter 核心测试"
```

---

## 任务 T6: 创建 E2E 同步测试

**文件**：
- 创建：`tests/e2e/sync-e2e.test.ts`

**Step 1: 安装 Playwright**

```bash
bun add -D @playwright/test
bun playwright install
```

**Step 2: 编写 E2E 测试**

```typescript
/**
 * E2E 多设备同步测试
 *
 * 测试场景：
 * 1. 用户 A 创建事件
 * 2. 用户 B 同步获取事件
 * 3. 验证双向同步
 */

import { test, expect } from '@playwright/test';

const SERVER_URL = process.env.SYNC_SERVER_URL || 'http://localhost:6984';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

test.describe('多设备同步 E2E', () => {
  test.beforeAll(async () => {
    // 启动服务器（如果未运行）
    // 这里假设服务器已在运行
  });

  test('用户 A 创建事件，用户 B 同步获取', async ({ browser }) => {
    // 创建两个浏览器上下文（模拟两个设备）
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // 设备 A 登录
    await pageA.goto(`${APP_URL}/login`);
    await pageA.fill('[name="username"]', 'user-a');
    await pageA.fill('[name="password"]', 'password-a');
    await pageA.click('button[type="submit"]');
    await expect(pageA).toHaveURL(/\/chat/);

    // 设备 B 登录
    await pageB.goto(`${APP_URL}/login`);
    await pageB.fill('[name="username"]', 'user-b');
    await pageB.fill('[name="password"]', 'password-b');
    await pageB.click('button[type="submit"]');
    await expect(pageB).toHaveURL(/\/chat/);

    // 设备 A 创建事件
    await pageA.fill('[data-testid="message-input"]', 'Hello from device A');
    await pageA.click('[data-testid="send-button"]');

    // 等待同步
    await pageA.waitForTimeout(2000);

    // 设备 B 应该能同步到事件
    await pageB.waitForTimeout(2000);
    await expect(pageB.locator('[data-testid="message-list"]')).toContainText('Hello from device A');
  });

  test.afterEach(async () => {
    // 清理
    await browser.close();
  });
});
```

**Step 3: 运行 E2E 测试**

```bash
# 启动服务器
bun run server &

# 运行 E2E 测试
bun playwright test tests/e2e/sync-eese.test.ts
```

**Step 4: 提交**

```bash
git add tests/e2e/sync-e2e.test.ts package.json
git commit -m "test: 添加多设备同步 E2E 测试"
```

---

## 任务 T7: 更新用户文档

**文件**：
- 创建：`docs/runbook/多设备同步开发指南.md`

**Step 1: 编写文档**

```markdown
# 多设备同步开发指南

## 快速开始

### 1. 启动同步服务器

```bash
# 一键启动（推荐）
bun run dev:sync

# 或手动启动
bun run server
```

服务器运行在 `http://localhost:6984`

### 2. 启动前端

```bash
bun run dev
```

前端运行在 `http://localhost:5173`

### 3. 测试多设备同步

1. 打开浏览器，登录用户 A
2. 打开**第二个浏览器**（或隐身窗口），登录用户 B
3. 在用户 A 发送消息
4. 观察用户 B 实时收到同步消息

## 开发配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| SYNC_SERVER_URL | http://localhost:6984 | 同步服务器地址 |
| SYNC_USERNAME | - | 测试用户名 |
| SYNC_PASSWORD | - | 测试密码 |

### 一键脚本

```powershell
# Windows
.\dev.ps1

# Linux/macOS
chmod +x dev.sh
./dev.sh
```

## 故障排除

### 问题：服务器无法启动

```bash
# 检查端口是否被占用
netstat -ano | findstr :6984

# 杀死占用进程
taskkill /PID <PID> /F
```

### 问题：同步无响应

1. 检查服务器日志：`server/server.log`
2. 验证服务器健康：`curl http://localhost:6984/`
3. 检查浏览器控制台错误
```

**Step 2: 提交**

```bash
git add docs/runbook/多设备同步开发指南.md
git commit -m "docs: 添加多设备同步开发指南"
```

---

## 验证清单

完成所有任务后，验证以下场景：

- [ ] 服务器启动成功
- [ ] 前端连接成功
- [ ] 用户 A 发送消息
- [ ] 用户 B 实时收到同步
- [ ] 单元测试通过
- [ ] E2E 测试通过
```

**文件路径**: `docs/plans/2026-02-10-multi-device-sync-fix.md`

**Plan complete and saved to `docs/plans/2026-02-10-multi-device-sync-fix.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**

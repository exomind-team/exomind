# SPEC-301: 多设备数据同步功能

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

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 (ExoMind)                             │
├─────────────────────────────────────────────────────────────────┤
│  Service 层                                                      │
│  ┌──────────────────┐  ┌──────────────────┐                   │
│  │ EventLogService  │  │  ConfigService   │                   │
│  └────────┬─────────┘  └────────┬─────────┘                     │
│           │                     │                                │
│           ▼                     ▼                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              ISyncPort (渐进式扩展接口)                    │  │
│  └────────────────────────┬────────────────────────────────┘  │
└───────────────────────────┼────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    存储抽象层                                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              IStoragePort                                 │  │
│  └────────────────────────┬────────────────────────────────┘  │
│           ┌──────────────┴──────────────┐                      │
│           ▼                              ▼                      │
│  ┌──────────────────┐        ┌──────────────────────────┐   │
│  │ WebStorageAdapter│        │ PouchSyncAdapter          │   │
│  │ (localStorage)   │        │ (PouchDB 本地同步)      │   │
│  └──────────────────┘        └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼ (WS / HTTP)
┌─────────────────────────────────────────────────────────────────┐
│                    后端服务 (Bun + PouchDB)                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  PouchDB Server (独立用户数据库)                          │  │
│  │  ├── user-alice.db  (认证: username + password hash)    │  │
│  │  ├── user-bob.db                                        │  │
│  │  └── ...                                                │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 文件结构

```
src/
├── lib/
│   ├── ports/
│   │   ├── sync.port.ts          # ISyncPort 接口定义
│   │   ├── import-export.port.ts # 导入导出接口
│   │   └── user.port.ts          # 用户管理接口
│   │
│   ├── adapters/
│   │   ├── pouch-sync.ts         # PouchDB 同步适配器
│   │   ├── crypto-adapter.ts     # Web Crypto API 加密适配器
│   │   └── user-adapter.ts       # 用户认证适配器
│   │
│   ├── sync/
│   │   ├── conflict-resolver.ts   # 冲突检测与解决
│   │   ├── device-manager.ts     # 设备管理（仅本地）
│   │   ├── import-export.ts      # 导入导出服务
│   │   └── sync-status.ts        # 同步状态管理
│   │
│   ├── services/
│   │   ├── user.service.ts       # 用户管理服务
│   │   └── sync.service.ts       # 同步服务
│   │
│   └── stores/
│       ├── sync-store.ts         # Zustand 同步状态 Store
│       └── user-store.ts         # Zustand 用户状态 Store
│
├── pages/
│   ├── SyncTestPage.tsx          # 同步测试页面 (/sync-test)
│   └── UserManagePage.tsx        # 用户管理页面 (/user-manage)
│
└── routes.tsx                    # 添加 /sync-test 和 /user-manage 路由

server/
└── pouchdb-server.js             # PouchDB Server 入口 (端口: 6984)

tests/
└── sync/
    ├── sync.port.test.ts         # 同步接口测试
    ├── conflict.test.ts          # 冲突处理测试
    ├── import-export.test.ts     # 导入导出测试
    └── user.test.ts             # 用户管理测试
```

---

## 3. 接口设计

### 3.1 ISyncPort 接口

```typescript
// src/lib/ports/sync.port.ts

import type { Event } from '@/lib/types/event';
import type { SyncStatus, SyncCredentials, SyncResult, Conflict } from './sync.types';

/**
 * 同步 Port 接口
 *
 * 渐进式扩展：保留 IStoragePort，新增同步相关方法
 */
export interface ISyncPort {
  // === 连接管理 ===
  /**
   * 连接到同步服务器
   */
  connect(url: string, credentials: SyncCredentials): Promise<void>;

  /**
   * 断开连接
   */
  disconnect(): Promise<void>;

  /**
   * 获取当前同步状态
   */
  getStatus(): SyncStatus;

  // === 事件同步 ===
  /**
   * 同步事件数据（双向）
   */
  syncEvents(): Promise<SyncResult>;

  /**
   * 推送单个事件到服务器
   */
  pushEvent(event: Event): Promise<void>;

  // === 配置同步 ===
  /**
   * 同步配置数据（双向）
   */
  syncConfig(): Promise<SyncResult>;

  /**
   * 推送配置到服务器
   */
  pushConfig(key: string, value: unknown): Promise<void>;

  // === 冲突处理 ===
  /**
   * 获取冲突列表
   */
  getConflicts(): Promise<Conflict[]>;

  /**
   * 解决冲突
   */
  resolveConflict(docId: string, resolution: 'local' | 'remote' | 'merge'): Promise<void>;

  // === 导入导出 ===
  /**
   * 从本地存储导入
   */
  importFromLocal(strategy: ImportStrategy): Promise<ImportResult>;

  /**
   * 导出到文件
   */
  exportToFile(): Promise<void>;
}

/**
 * 导入策略
 */
export type ImportStrategy = 'merge' | 'skip' | 'overwrite';

/**
 * 导入结果
 */
export interface ImportResult {
  success: boolean;
  importedCount: number;
  skippedCount: number;
  conflictCount: number;
  errors: string[];
}
```

### 3.2 类型定义

```typescript
// src/lib/ports/sync.types.ts

/**
 * 设备类型枚举
 */
export enum DeviceType {
  PHONE = 'phone',
  TABLET = 'tablet',
  DESKTOP = 'desktop',
  SERVER = 'server',
}

/**
 * 认证凭据
 */
export interface SyncCredentials {
  username: string;
  passwordHash: string;  // 本地哈希后的密码
  deviceName: string;    // 用户指定的设备名
  deviceType: DeviceType;
  platform: string;      // 'Windows', 'macOS', 'Android', 'iOS', 'Linux'
}

/**
 * 同步状态
 */
export interface SyncStatus {
  state: 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error';
  lastSync: number | null;
  pendingChanges: number;
  conflictCount: number;
  syncMode: 'realtime' | 'polling';
  pollInterval: number;   // 轮询间隔（分钟）
  error?: string;
}

/**
 * 同步结果
 */
export interface SyncResult {
  success: boolean;
  uploaded: number;      // 上传数量
  downloaded: number;    // 下载数量
  conflicts: number;      // 冲突数量
  errors: string[];
}

/**
 * 冲突信息
 */
export interface Conflict {
  id: string;
  docId: string;
  docType: 'event' | 'config';
  local: {
    value: unknown;
    timestamp: number;
    deviceId: string;
  };
  remote: {
    value: unknown;
    timestamp: number;
    deviceId: string;
  };
  resolved: boolean;
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

文档类型 2: 事件 (_design/sync/views/events)  [同步]
├── _id: 'event:{uuid}'
├── type: 'event'
├── eventId: uuid
├── content: string
├── timestamp: ISO8601
├── tags: string[]
├── deviceId: uuid
├── _rev: string          # CouchDB 版本控制（用于冲突检测）
└── _deleted: boolean     # 软删除

文档类型 3: 配置 (_design/sync/views/config)  [同步]
├── _id: 'config:{key}'
├── type: 'config'
├── key: string            # 'theme', 'voice', 'shortcuts', 'api:*', ...
├── value: any             # JSON 值
├── encrypted: boolean     # 是否加密（AES-256）
├── deviceId: uuid         # 最后修改设备
├── updatedAt: ISO8601
├── scope: 'global' | 'local'  # 作用域：全局同步 | 本地设备
└── _rev: string

文档类型 4: 设备信息  [仅本地，不同步，使用 localStorage]
├── _id: 'device:{deviceId}'
├── deviceName: string    # 用户指定的名称
├── deviceType: DeviceType
├── platform: string
├── lastSync: ISO8601
└── createdAt: ISO8601

### 4.1.1 配置作用域说明

| 作用域 | 键名示例 | 是否同步 | 说明 |
|--------|---------|---------|------|
| global | theme, shortcuts, api:* | 同步 | 通用配置，所有设备共享 |
| local | voice.language, voice.autoSend | 不同步 | 设备本地配置 |

```typescript
// 配置文档示例
{
  _id: 'config:theme',
  type: 'config',
  key: 'theme',
  value: { mode: 'dark' },
  scope: 'global',           // 全局配置
  encrypted: false,
  deviceId: '...',
  updatedAt: '2024-01-15T10:30:00Z'
}

{
  _id: 'config:voice.language',
  type: 'config',
  key: 'voice.language',
  value: 'zh-CN',
  scope: 'local',            // 本地配置，不同步
  encrypted: false,
  deviceId: '...',
  updatedAt: '2024-01-15T10:30:00Z'
}

{
  _id: 'config:api:moss',
  type: 'config',
  key: 'api:moss',
  value: 'encrypted_key_here',
  scope: 'global',
  encrypted: true,           // API 密钥加密
  deviceId: '...',
  updatedAt: '2024-01-15T10:30:00Z'
}
```

### 4.1.2 设备信息存储策略

```typescript
// 设备信息存储在 localStorage，仅本地使用，不同步
const DEVICE_ID_KEY = 'exomind:deviceId';
const DEVICE_INFO_KEY = 'exomind:deviceInfo';

// 设备信息结构
interface DeviceInfo {
  deviceId: string;           // UUID，首次使用时生成并永久保存
  deviceName: string;        // 用户指定的设备名称
  deviceType: DeviceType;    // phone/tablet/desktop/server
  platform: string;          // Windows/macOS/Android/iOS/Linux
  createdAt: number;         // 创建时间戳
  lastSync: number;          // 最后同步时间
}

// 不同设备有各自的 localStorage，互相不可见
// 设备名称在各自设备上独立设置
```

### 4.2 事件数据结构

```typescript
interface Event {
  id: string;
  type: string;
  content: string;
  timestamp: string;  // ISO8601
  tags?: string[];
  metadata?: Record<string, unknown>;
  deviceId: string;   // 记录来源设备
}
```

### 4.3 配置数据结构

```typescript
interface Config {
  // 主题配置
  theme: {
    mode: 'light' | 'dark' | 'system';
    primaryColor: string;
  };

  // 语音配置
  voice: {
    language: string;
    autoSend: boolean;
    silenceTimeout: number;
  };

  // 快捷键配置
  shortcuts: Record<string, string>;

  // API Keys (AES-256 加密)
  'api:moss': {
    key: string;       // 加密后
    enabled: boolean;
  };
  'api:other': {
    key: string;
    enabled: boolean;
  };
}
```

---

## 5. 核心实现

### 5.1 设备管理

```typescript
// src/lib/sync/device-manager.ts

import { v4 as uuidv4 } from 'uuid';

const DEVICE_ID_KEY = 'exomind:deviceId';
const DEVICE_INFO_KEY = 'exomind:deviceInfo';

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  platform: string;
  createdAt: number;
}

/**
 * 获取或生成设备 ID
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') {
    return uuidv4();  // SSR 环境
  }

  const stored = localStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;

  const newId = uuidv4();
  localStorage.setItem(DEVICE_ID_KEY, newId);
  return newId;
}

/**
 * 获取设备信息
 */
export function getDeviceInfo(): DeviceInfo | null {
  if (typeof window === 'undefined') return null;

  const stored = localStorage.getItem(DEVICE_INFO_KEY);
  if (!stored) return null;

  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

/**
 * 保存设备信息
 */
export function saveDeviceInfo(info: DeviceInfo): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DEVICE_INFO_KEY, JSON.stringify(info));
}

/**
 * 初始化设备（首次使用时）
 */
export function initDevice(
  name: string,
  type: DeviceType,
  platform: string
): DeviceInfo {
  const deviceId = getDeviceId();
  const info: DeviceInfo = {
    deviceId,
    deviceName: name,
    deviceType: type,
    platform,
    createdAt: Date.now(),
  };
  saveDeviceInfo(info);
  return info;
}
```

### 5.2 密码哈希

```typescript
// src/lib/sync/password-hash.ts

/**
 * 生成随机盐
 */
function generateSalt(length: number = 16): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * SHA-256 哈希
 */
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 哈希密码（加盐）
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt(16);
  const hash = await sha256(password + salt);
  return `${salt}:${hash}`;  // 格式: salt:hash
}

/**
 * 验证密码
 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  const computedHash = await sha256(password + salt);
  return `${salt}:${computedHash}` === stored;
}
```

### 5.3 AES-256 加密（Web Crypto API）

```typescript
// src/lib/adapters/crypto-adapter.ts

/**
 * 加密密钥存储键
 */
const ENCRYPTION_KEY_ID = 'exomind:encryptionKey';

/**
 * 生成加密密钥（使用 Web Crypto API）
 */
export async function generateEncryptionKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * 导出密钥为可存储格式（用于 localStorage）
 */
export async function exportKey(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

/**
 * 导入密钥（从 localStorage）
 */
export async function importKey(keyData: string): Promise<CryptoKey> {
  const keyBytes = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * 获取或创建加密密钥
 */
export async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
  if (typeof window === 'undefined') {
    throw new Error('Encryption only works in browser');
  }

  const stored = localStorage.getItem(ENCRYPTION_KEY_ID);
  if (stored) {
    return await importKey(stored);
  }

  const key = await generateEncryptionKey();
  const exported = await exportKey(key);
  localStorage.setItem(ENCRYPTION_KEY_ID, exported);
  return key;
}

/**
 * AES-256-GCM 加密
 */
export async function encryptAes256(plaintext: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  // 生成随机 IV (12字节)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // 获取加密密钥
  const key = await getOrCreateEncryptionKey();

  // 加密
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  // 组合 IV + 加密数据
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  // Base64 编码
  return btoa(String.fromCharCode(...combined));
}

/**
 * AES-256-GCM 解密
 */
export async function decryptAes256(ciphertext: string): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Base64 解码
  const combined = new Uint8Array(
    atob(ciphertext).split('').map(c => c.charCodeAt(0))
  );

  // 提取 IV
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);

  // 获取解密密钥
  const key = await getOrCreateEncryptionKey();

  // 解密
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );

  return decoder.decode(decrypted);
}
```

```

### 5.5 用户管理接口

```typescript
// src/lib/ports/user.port.ts

/**
 * 用户管理 Port 接口
 */
export interface IUserPort {
  /**
   * 注册新用户
   */
  register(username: string, password: string): Promise<void>;

  /**
   * 登录
   */
  login(username: string, password: string): Promise<UserSession>;

  /**
   * 退出登录
   */
  logout(): Promise<void>;

  /**
   * 切换用户
   */
  switchUser(username: string): Promise<void>;

  /**
   * 获取当前用户
   */
  getCurrentUser(): UserSession | null;

  /**
   * 获取已登录用户列表
   */
  getLoggedInUsers(): UserSession[];

  /**
   * 删除用户（仅删除本地记录，不删除服务器数据）
   */
  removeUser(username: string): Promise<void>;
}

/**
 * 用户会话信息
 */
export interface UserSession {
  username: string;
  deviceName: string;
  deviceId: string;
  token: string;
  lastLogin: number;
}
```

### 5.6 设备管理（仅本地存储）

```typescript
// src/lib/sync/device-manager.ts

import { v4 as uuidv4 } from 'uuid';

const DEVICE_ID_KEY = 'exomind:deviceId';
const DEVICE_INFO_KEY = 'exomind:deviceInfo';

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  platform: string;
  createdAt: number;
}

/**
 * 获取或生成设备 ID（仅本地）
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') {
    return uuidv4();
  }

  const stored = localStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;

  const newId = uuidv4();
  localStorage.setItem(DEVICE_ID_KEY, newId);
  return newId;
}

/**
 * 获取设备信息（仅本地）
 */
export function getDeviceInfo(): DeviceInfo | null {
  if (typeof window === 'undefined') return null;

  const stored = localStorage.getItem(DEVICE_INFO_KEY);
  if (!stored) return null;

  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

/**
 * 保存设备信息（仅本地）
 */
export function saveDeviceInfo(info: DeviceInfo): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DEVICE_INFO_KEY, JSON.stringify(info));
}

/**
 * 初始化设备（首次使用时）
 */
export function initDevice(
  name: string,
  type: DeviceType,
  platform: string
): DeviceInfo {
  const deviceId = getDeviceId();
  const info: DeviceInfo = {
    deviceId,
    deviceName: name,
    deviceType: type,
    platform,
    createdAt: Date.now(),
  };
  saveDeviceInfo(info);
  return info;
}

/**
 * 自动检测设备类型
 */
export function detectDeviceType(): DeviceType {
  const ua = navigator.userAgent;

  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return DeviceType.TABLET;
  }
  if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
    return DeviceType.PHONE;
  }
  return DeviceType.DESKTOP;
}

/**
 * 自动检测平台
 */
export function detectPlatform(): string {
  const { userAgent, platform } = navigator;
  if (/Android/.test(userAgent)) return 'Android';
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'iOS';
  if (/Mac/.test(platform)) return 'macOS';
  if (/Win/.test(platform)) return 'Windows';
  if (/Linux/.test(platform)) return 'Linux';
  return platform;
}
```

### 5.7 冲突解决

```typescript
// src/lib/sync/conflict-resolver.ts

import type { Conflict } from '@/lib/ports/sync.types';

interface DocWithRev {
  value: unknown;
  timestamp: number;
  deviceId: string;
  _rev?: string;
}

/**
 * LWW 冲突解决
 */
export function resolveByLWW(
  local: DocWithRev,
  remote: DocWithRev
): 'local' | 'remote' {
  if (local.timestamp > remote.timestamp) {
    return 'local';
  } else if (local.timestamp < remote.timestamp) {
    return 'remote';
  }

  // 时间戳相同，比较设备 ID（最后写入的设备胜出）
  return local.deviceId > remote.deviceId ? 'local' : 'remote';
}

/**
 * 检测冲突
 */
export function detectConflict(
  local: DocWithRev,
  remote: DocWithRev
): boolean {
  // 如果两者都有修改且时间戳不同，则有冲突
  return (
    local.timestamp !== remote.timestamp &&
    local.deviceId !== remote.deviceId
  );
}

/**
 * 创建冲突对象
 */
export function createConflict(
  docId: string,
  docType: 'event' | 'config',
  local: DocWithRev,
  remote: DocWithRev
): Conflict {
  return {
    id: `${docId}-${Date.now()}`,
    docId,
    docType,
    local,
    remote,
    resolved: false,
  };
}
```

---

## 6. 测试页面设计

### 6.1 UI 布局

```
SyncTestPage (路由: /sync-test)
│
├── 页面标题: "同步测试"
│
├── 区域 1: 连接设置
│   ├── 服务器地址: [______________] : [____]
│   │                  IP 地址          端口
│   ├── 用户名: [______________]
│   ├── 密码: [______________]
│   ├── ☐ 保存密码
│   └── [连接] [断开] 按钮
│       └── 状态: 🟢 已连接 / 🔴 已断开
│
├── 区域 2: 设备信息
│   ├── 设备ID: [________________________________] (只读)
│   ├── 设备名称: [______________] + [保存]
│   ├── 设备类型: [手机 ▼] + [电脑 ▼] + [平板 ▼] + [服务器 ▼]
│   └── Platform: [______________] (自动检测)
│
├── 区域 3: 同步控制
│   ├── [立即同步] 按钮
│   ├── 同步模式: (●) 实时  ( ) 定时
│   └── 定时间隔: [___] 分钟 (仅定时模式)
│
├── 区域 4: 导入导出
│   ├── [从本地导入] + 下拉: [合并 ▼] [跳过 ▼] [覆盖 ▼]
│   └── [导出到文件] 按钮
│
├── 区域 5: 冲突列表
│   ├── 冲突数量: [3]
│   └── 冲突条目 (可展开)
│       ├── 文档: config:theme
│       │   ├── 本地 (2024-01-15 10:30, 设备A)
│       │   └── 远端 (2024-01-15 10:31, 设备B)
│       ├── [保留本地] [保留远端] [手动合并]
│       └── ───────────────────────────────
│
├── 区域 6: 数据预览
│   ├── 事件数量: [128]
│   ├── 配置项: theme, voice, shortcuts, api:moss
│   └── [查看详情 ▼]
│
└── 区域 7: 测试日志 (滚动区域)
    ├── [INFO] 设备ID: 550e8400-e29b-41d4-a716-446655440000
    ├── [INFO] 连接到服务器: 192.168.1.100:6984
    ├── [SUCCESS] 同步完成: 15 条新事件
    ├── [WARN] 检测到 2 个冲突
    └── [ERROR] 连接失败: 超时
```

### 6.2 组件结构

```tsx
// src/pages/SyncTestPage.tsx

import { useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { useSyncStore } from '@/lib/stores/sync-store';
import { getDeviceId, initDevice } from '@/lib/sync/device-manager';

interface LogEntry {
  level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
  message: string;
  timestamp: number;
}

export function SyncTestPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsRef = useRef<HTMLDivElement>(null);

  const {
    status,
    credentials,
    conflicts,
    syncConfig,
    connect,
    disconnect,
    syncNow,
    resolveConflict,
  } = useSyncStore();

  // 自动滚动日志
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  // 添加日志
  const addLog = (level: LogEntry['level'], message: string) => {
    setLogs(prev => [...prev, {
      level,
      message,
      timestamp: Date.now(),
    }]);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">同步测试</h1>

      {/* 连接设置 */}
      <Card>
        <CardHeader>
          <CardTitle>连接设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Input
              placeholder="服务器 IP"
              defaultValue="192.168.1.100"
            />
            <Input
              placeholder="端口"
              defaultValue="6984"
              className="w-24"
            />
          </div>
          <Input placeholder="用户名" />
          <Input type="password" placeholder="密码" />
          <div className="flex items-center gap-2">
            <input type="checkbox" id="savePassword" />
            <label htmlFor="savePassword">保存密码</label>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => connect()}>连接</Button>
            <Button variant="outline" onClick={() => disconnect()}>
              断开
            </Button>
            <Badge variant={status.state === 'connected' ? 'default' : 'destructive'}>
              {status.state === 'connected' ? '已连接' : '已断开'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* 设备信息 */}
      <Card>
        <CardHeader>
          <CardTitle>设备信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground">设备ID</label>
            <Input value={getDeviceId()} readOnly className="font-mono text-sm" />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">设备名称</label>
            <div className="flex gap-2">
              <Input placeholder="给设备起个名字" />
              <Button>保存</Button>
            </div>
          </div>
          <div>
            <label className="text-sm text-muted-foreground">设备类型</label>
            <Select defaultValue="desktop">
              <option value="phone">手机</option>
              <option value="tablet">平板</option>
              <option value="desktop">电脑</option>
              <option value="server">服务器</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 同步控制 */}
      <Card>
        <CardHeader>
          <CardTitle>同步控制</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={() => syncNow()}>立即同步</Button>
          <div className="flex items-center gap-4">
            <label>
              <input
                type="radio"
                name="syncMode"
                value="realtime"
                defaultChecked
              /> 实时
            </label>
            <label>
              <input type="radio" name="syncMode" value="polling" /> 定时
            </label>
            <Input
              type="number"
              defaultValue="5"
              className="w-20"
              placeholder="分钟"
            />
          </div>
          <div className="text-sm text-muted-foreground">
            上次同步: {status.lastSync
              ? new Date(status.lastSync).toLocaleString()
              : '从未'}
          </div>
        </CardContent>
      </Card>

      {/* 导入导出 */}
      <Card>
        <CardHeader>
          <CardTitle>导入导出</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-4">
          <Button variant="outline">从本地导入</Button>
          <Select defaultValue="merge">
            <option value="merge">合并</option>
            <option value="skip">跳过</option>
            <option value="overwrite">覆盖</option>
          </Select>
          <Button variant="outline">导出到文件</Button>
        </CardContent>
      </Card>

      {/* 冲突列表 */}
      {conflicts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>冲突列表 ({conflicts.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {conflicts.map(conflict => (
              <div key={conflict.id} className="border rounded p-4 mb-4">
                <div className="font-mono text-sm">{conflict.docId}</div>
                <div className="flex gap-2 mt-2">
                  <Button
                    size="sm"
                    onClick={() => resolveConflict(conflict.docId, 'local')}
                  >
                    保留本地
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resolveConflict(conflict.docId, 'remote')}
                  >
                    保留远端
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 测试日志 */}
      <Card>
        <CardHeader>
          <CardTitle>测试日志</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            ref={logsRef}
            className="h-48 overflow-y-auto font-mono text-sm bg-muted rounded p-4 space-y-1"
          >
            {logs.map((log, i) => (
              <div
                key={i}
                className={{
                  'text-blue-600': log.level === 'INFO',
                  'text-green-600': log.level === 'SUCCESS',
                  'text-yellow-600': log.level === 'WARN',
                  'text-red-600': log.level === 'ERROR',
                }}
              >
                [{new Date(log.timestamp).toLocaleTimeString()}] {log.message}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

---

## 6. 用户管理页面

### 6.1 UI 布局

```
UserManagePage (路由: /user-manage)
│
├── 页面标题: "用户管理"
│
├── 区域 1: 当前用户信息
│   ├── 用户名: [alice]
│   ├── 已登录: [✓]
│   └── [退出登录] 按钮
│
├── 区域 2: 用户切换
│   ├── 当前用户: [alice ▼]
│   ├── [切换用户] 按钮
│   └── [添加新用户] 按钮
│
├── 区域 3: 添加/注册新用户
│   ├── 新用户名: [______________]
│   ├── 新密码: [______________]
│   ├── 确认密码: [______________]
│   └── [注册] 按钮
│       └── 验证: 用户名唯一性、密码一致性
│
├── 区域 4: 用户列表
│   ├── [alice] - 已登录 (当前设备)
│   ├── [bob] - 已登录 (设备: 我的 MacBook)
│   ├── [charlie] - 未登录
│   └── [管理] [删除]
│
└── 区域 5: 测试日志
    ├── [INFO] 用户 alice 登录成功
    ├── [SUCCESS] 用户 bob 添加到设备列表
    └── [WARN] 用户 charlie 不存在
```

### 6.2 组件结构

```tsx
// src/pages/UserManagePage.tsx

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useUserStore } from '@/lib/stores/user-store';

interface LogEntry {
  level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
  message: string;
  timestamp: number;
}

export function UserManagePage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const {
    currentUser,
    loggedInUsers,
    isLoggedIn,
    login,
    logout,
    register,
    switchUser,
  } = useUserStore();

  // 添加日志
  const addLog = (level: LogEntry['level'], message: string) => {
    setLogs(prev => [...prev, {
      level,
      message,
      timestamp: Date.now(),
    }]);
  };

  // 处理注册
  const handleRegister = async () => {
    if (newPassword !== confirmPassword) {
      addLog('ERROR', '两次输入的密码不一致');
      return;
    }

    try {
      await register(newUsername, newPassword);
      addLog('SUCCESS', `用户 ${newUsername} 注册成功`);
      setNewUsername('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      addLog('ERROR', `注册失败: ${error.message}`);
    }
  };

  // 处理登录
  const handleLogin = async (username: string, password: string) => {
    try {
      await login(username, password);
      addLog('SUCCESS', `用户 ${username} 登录成功`);
    } catch (error) {
      addLog('ERROR', `登录失败: ${error.message}`);
    }
  };

  // 处理退出
  const handleLogout = () => {
    if (currentUser) {
      addLog('INFO', `用户 ${currentUser} 已退出`);
      logout();
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">用户管理</h1>

      {/* 当前用户信息 */}
      <Card>
        <CardHeader>
          <CardTitle>当前用户</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-muted-foreground">用户名: </span>
              <span className="font-medium">{currentUser || '未登录'}</span>
            </div>
            <Badge variant={isLoggedIn ? 'default' : 'secondary'}>
              {isLoggedIn ? '已登录' : '未登录'}
            </Badge>
          </div>
          {isLoggedIn && (
            <Button variant="outline" onClick={handleLogout}>
              退出登录
            </Button>
          )}
        </CardContent>
      </Card>

      {/* 添加新用户 */}
      <Card>
        <CardHeader>
          <CardTitle>添加新用户</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="用户名"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
          />
          <Input
            type="password"
            placeholder="密码"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <Input
            type="password"
            placeholder="确认密码"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          <Button onClick={handleRegister}>注册</Button>
        </CardContent>
      </Card>

      {/* 已登录用户列表 */}
      <Card>
        <CardHeader>
          <CardTitle>已登录用户</CardTitle>
        </CardHeader>
        <CardContent>
          {loggedInUsers.length === 0 ? (
            <p className="text-muted-foreground">暂无已登录用户</p>
          ) : (
            <div className="space-y-2">
              {loggedInUsers.map(user => (
                <div
                  key={user.username}
                  className="flex items-center justify-between border rounded p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{user.username}</span>
                    {user.username === currentUser && (
                      <Badge variant="secondary">当前</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {user.deviceName}
                    </span>
                    {user.username !== currentUser && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => switchUser(user.username)}
                      >
                        切换
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 测试日志 */}
      <Card>
        <CardHeader>
          <CardTitle>操作日志</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 overflow-y-auto font-mono text-sm bg-muted rounded p-4 space-y-1">
            {logs.map((log, i) => (
              <div
                key={i}
                className={{
                  'text-blue-600': log.level === 'INFO',
                  'text-green-600': log.level === 'SUCCESS',
                  'text-yellow-600': log.level === 'WARN',
                  'text-red-600': log.level === 'ERROR',
                }}
              >
                [{new Date(log.timestamp).toLocaleTimeString()}] {log.message}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

### 6.3 用户存储 Store

```typescript
// src/lib/stores/user-store.ts

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UserState {
  currentUser: string | null;
  loggedInUsers: Array<{
    username: string;
    deviceName: string;
    lastLogin: number;
  }>;
  token: string | null;

  // 操作
  register: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  switchUser: (username: string) => Promise<void>;
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      loggedInUsers: [],
      token: null,

      async register(username: string, password: string) {
        // 调用后端注册
        const response = await fetch('http://localhost:6984/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error);
        }
      },

      async login(username: string, password: string) {
        // 调用后端登录
        const response = await fetch('http://localhost:6984/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error);
        }

        const { token } = await response.json();

        // 保存登录状态
        set(state => ({
          currentUser: username,
          token,
          loggedInUsers: state.loggedInUsers.some(u => u.username === username)
            ? state.loggedInUsers
            : [...state.loggedInUsers, {
                username,
                deviceName: '当前设备',  // 可从 device-manager 获取
                lastLogin: Date.now(),
              }],
        }));
      },

      logout() {
        set({ currentUser: null, token: null });
      },

      async switchUser(username: string) {
        const { loggedInUsers } = get();
        const user = loggedInUsers.find(u => u.username === username);

        if (user) {
          set({ currentUser: username });
        } else {
          // 未登录的用户需要先登录
          throw new Error(`用户 ${username} 未登录`);
        }
      },
    }),
    {
      name: 'exomind:user-store',
    }
  )
);
```

---

## 7. 后端服务

### 7.1 PouchDB Server 启动脚本

```javascript
// server/pouchdb-server.js

import PouchDB from 'pouchdb';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import http from 'http';
import fs from 'fs';
import path from 'path';

// 用户数据库目录
const DB_DIR = path.resolve('./data');

// 确保目录存在
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// 创建 Express 应用
const app = express();
app.use(cors());
app.use(express.json());

// HTTP 服务器
const server = http.createServer(app);

// WebSocket 服务器
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// 用户认证
const users = new Map();  // username -> { passwordHash, db }

// SHA-256 哈希函数（后端）
import { createHash } from 'crypto';

function sha256(message: string): string {
  return createHash('sha256').update(message).digest('hex');
}

// 初始化用户
function initUser(username: string, passwordHash: string) {
  users.set(username, { passwordHash });
  const dbPath = path.join(DB_DIR, `user-${username}.db`);
  return new PouchDB(dbPath);
}

// 认证中间件
app.use('/db/:username/*', async (req, res, next) => {
  const { username } = req.params;
  const authHeader = req.headers.authorization;

  const user = users.get(username);
  if (!user) {
    return res.status(401).json({ error: '用户不存在' });
  }

  // 验证密码（Bearer token 格式: "Bearer <passwordHash>"）
  const token = authHeader?.replace('Bearer ', '');
  if (token !== user.passwordHash) {
    return res.status(403).json({ error: '密码错误' });
  }

  next();
});

// 用户注册
app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码必填' });
  }

  if (users.has(username)) {
    return res.status(409).json({ error: '用户已存在' });
  }

  const passwordHash = sha256(password);  // 简单哈希，实际可加盐
  initUser(username, passwordHash);

  res.json({ success: true, message: '用户注册成功' });
});

// 用户登录
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const user = users.get(username);
  if (!user) {
    return res.status(401).json({ error: '用户不存在' });
  }

  const passwordHash = sha256(password);
  if (passwordHash !== user.passwordHash) {
    return res.status(403).json({ error: '密码错误' });
  }

  // 返回 token（用于后续请求）
  res.json({ success: true, token: user.passwordHash });
});

// 创建/获取用户数据库
app.post('/db/:username', async (req, res) => {
  const { username, passwordHash } = req.body;

  try {
    if (!users.has(username)) {
      initUser(username, passwordHash);
    }
    res.json({ success: true, database: `user-${username}.db` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 同步变化监听
io.on('connection', (socket) => {
  console.log('客户端连接:', socket.id);

  socket.on('subscribe', ({ username, deviceId }) => {
    socket.join(`user:${username}`);
    console.log(`客户端 ${deviceId} 订阅用户 ${username}`);
  });

  socket.on('unsubscribe', ({ username }) => {
    socket.leave(`user:${username}`);
  });
});

// 广播变化
function broadcastChange(username, change) {
  io.to(`user:${username}`).emit('change', change);
}

// 启动服务器
const PORT = process.env.PORT || 6984;  // 默认 6984，避免与 CouchDB 5984 冲突
server.listen(PORT, () => {
  console.log(`PouchDB Server 运行在 http://localhost:${PORT}`);
});
```

---

## 8. 测试用例

### 8.1 单元测试

```typescript
// tests/sync/conflict.test.ts

import { describe, it, expect } from 'vitest';
import { resolveByLWW, detectConflict } from '@/lib/sync/conflict-resolver';

describe('冲突解决', () => {
  it('应该选择时间戳更新的版本', () => {
    const local = { timestamp: 1000, deviceId: 'A' };
    const remote = { timestamp: 900, deviceId: 'B' };

    expect(resolveByLWW(local, remote)).toBe('local');
  });

  it('应该选择时间戳更新的远端版本', () => {
    const local = { timestamp: 1000, deviceId: 'A' };
    const remote = { timestamp: 1100, deviceId: 'B' };

    expect(resolveByLWW(local, remote)).toBe('remote');
  });

  it('时间戳相同时选择设备ID更大的', () => {
    const local = { timestamp: 1000, deviceId: 'A' };
    const remote = { timestamp: 1000, deviceId: 'B' };

    expect(resolveByLWW(local, remote)).toBe('remote');
  });

  it('应该正确检测冲突', () => {
    const local = { timestamp: 1000, deviceId: 'A' };
    const remote = { timestamp: 1100, deviceId: 'B' };

    expect(detectConflict(local, remote)).toBe(true);
  });

  it('相同设备不应有冲突', () => {
    const local = { timestamp: 1000, deviceId: 'A' };
    const remote = { timestamp: 1100, deviceId: 'A' };

    expect(detectConflict(local, remote)).toBe(false);
  });
});
```

### 8.2 集成测试

```typescript
// tests/sync/sync.port.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { PouchSyncAdapter } from '@/lib/adapters/pouch-sync';

describe('PouchSyncAdapter', () => {
  let adapter: PouchSyncAdapter;

  beforeEach(() => {
    adapter = new PouchSyncAdapter();
  });

  it('应该正确连接', async () => {
    await expect(
      adapter.connect('http://localhost:6984', {
        username: 'test',
        passwordHash: 'hash',
        deviceName: '测试设备',
        deviceType: 'desktop',
        platform: 'Windows',
      })
    ).resolves.not.toThrow();
  });

  it('应该获取同步状态', () => {
    const status = adapter.getStatus();

    expect(status).toHaveProperty('state');
    expect(status).toHaveProperty('lastSync');
    expect(status).toHaveProperty('pendingChanges');
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

---

## 10. 依赖清单

| 包名 | 版本 | 用途 |
|------|------|------|
| `pouchdb` | ^8.0.0 | 客户端数据库 |
| `socket.io-client` | ^4.7.0 | WebSocket 客户端 |
| `crypto-js` | ^4.2.0 | AES 加密（备选） |

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

- [ ] 支持云端 CouchDB（替换 PouchDB Server）
- [ ] 端到端加密（E2EE）
- [ ] 多设备会话管理
- [ ] 同步历史回滚

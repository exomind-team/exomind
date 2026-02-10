# SPEC-304: 用户认证模块重构

## 1. 问题分析

### 1.1 当前问题

**问题 1：混合职责**

```
sync-store.ts 当前职责：
├── UI 状态管理 (Zustand)
├── 用户认证逻辑 (register/login)
├── 密码哈希 (依赖 CryptoAdapter)
└── 同步连接管理 (PouchSyncAdapter)
```

违反 v4 分层原则：L4 UI Store 不应该包含业务逻辑。

**问题 2：密码存储安全隐患**

```
localStorage 存储结构：
{
  "exomind:users": [
    {
      "username": "alice",
      "passwordHash": "salthash...",  // ✓ 已哈希
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

当前已正确使用哈希存储，但需要确认。

---

## 2. 目标

| 目标 | 说明 |
|------|------|
| 职责分离 | sync-store 只管 UI 状态，用户逻辑抽取到 L3 Service |
| 接口隔离 | L3 Service 通过接口定义，L4 通过接口使用 |
| 可测试 | 用户认证逻辑可独立单元测试 |
| 可复用 | 用户 Service 可被不同 UI 组件使用 |

---

## 3. 架构设计

### 3.1 v4 分层定位

```
┌─────────────────────────────────────────────────────────────────┐
│  L4 UI                                                          │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ UserManagePage    │  │ SyncTestPage      │                │
│  └────────┬─────────┘  └────────┬─────────┘                  │
│           │                     │                             │
│           └──────────┬──────────┘                             │
│                      ▼                                          │
│           ┌─────────────────────┐                            │
│           │   useSyncStore     │ ← UI 状态 (Zustand)         │
│           │   useUserStore     │ ← 可选拆分                  │
│           └──────────┬──────────┘                            │
└──────────────────────┼────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  L3 Service / Actor                                              │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  IUserService                                           │  │
│  │  ├── register(username, password)                      │  │
│  │  ├── login(username, password)                         │  │
│  │  ├── logout()                                         │  │
│  │  └── getCurrentUser()                                  │  │
│  └────────────────────────┬────────────────────────────────┘  │
│                          │                                    │
│           ┌──────────────┴──────────────┐                      │
│           ▼                              ▼                      │
│  ┌──────────────────┐        ┌──────────────────────────┐   │
│  │ UserServiceImpl   │        │ CryptoAdapter            │   │
│  │                   │        │ (L1 Adapter)             │   │
│  │ - 用户注册        │        │ - hashPassword           │   │
│  │ - 用户登录        │        │ - verifyPassword         │   │
│  │ - 会话管理        │        │ - generateSalt           │   │
│  └──────────────────┘        └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  L2 Environment                                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  ICryptoPort (已定义)                                   │  │
│  │  IUserPort (可选，需要定义)                             │  │
│  └────────────────────────┬────────────────────────────────┘  │
└───────────────────────────┼────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  L1 Adapter                                                     │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  CryptoAdapter                                          │  │
│  │  └── 密码哈希实现                                       │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 文件结构

```
src/
├── adapters/
│   └── crypto-adapter.ts       # [已存在] 密码哈希实现
│
├── services/                    # [新增] L3 Service 层
│   ├── interfaces/             # [新增] Service 接口
│   │   └── user.service.ts    # IUserService 接口
│   │
│   └── impl/                  # [新增] Service 实现
│       └── user.service.impl.ts
│
├── environment/
│   └── interfaces/
│       └── crypto.port.ts      # [已存在] ICryptoPort
│
└── ui/
    └── stores/
        └── sync-store.ts       # [待重构] 只管 UI 状态

tests/
└── sync/
    └── user.service.test.ts    # [新增] 用户服务测试
```

---

## 4. 接口设计

### 4.1 IUserService 接口

```typescript
// src/services/interfaces/user.service.ts

/**
 * 用户服务接口
 *
 * L3 Service 接口归 L3 所有
 * 定义用户认证业务逻辑
 */
export interface IUserService {
  /**
   * 注册新用户
   *
   * @param username - 用户名
   * @param password - 密码（明文，内部哈希存储）
   * @returns 注册成功的用户信息
   * @throws Error - 用户名已存在
   */
  register(username: string, password: string): Promise<UserInfo>;

  /**
   * 用户登录
   *
   * @param username - 用户名
   * @param password - 密码
   * @returns 登录成功的会话信息
   * @throws Error - 用户不存在或密码错误
   */
  login(username: string, password: string): Promise<UserSession>;

  /**
   * 用户登出
   */
  logout(): Promise<void>;

  /**
   * 获取当前用户
   */
  getCurrentUser(): UserSession | null;

  /**
   * 检查用户名是否已存在
   */
  usernameExists(username: string): Promise<boolean>;
}

/**
 * 用户基本信息
 */
export interface UserInfo {
  username: string;
  createdAt: string;
}

/**
 * 用户会话信息
 */
export interface UserSession {
  username: string;
  deviceName: string;
  deviceId: string;
  lastLogin: number;
}
```

---

## 5. 实现设计

### 5.1 UserServiceImpl

```typescript
// src/services/impl/user.service.impl.ts

import { IUserService, UserInfo, UserSession } from '../interfaces/user.service';
import { CryptoAdapter, hashPasswordWithSalt, verifyPassword } from '@/adapters/crypto-adapter';

/**
 * 用户服务实现
 *
 * 依赖：
 * - CryptoAdapter (L1) - 密码哈希
 * - localStorage - 用户数据存储
 */
export class UserServiceImpl implements IUserService {
  private crypto: CryptoAdapter;
  private storageKey = 'exomind:users';
  private sessionKey = 'exomind:currentUser';

  constructor() {
    this.crypto = new CryptoAdapter();
  }

  async register(username: string, password: string): Promise<UserInfo> {
    // 验证输入
    if (!username || !password) {
      throw new Error('用户名和密码不能为空');
    }

    if (password.length < 6) {
      throw new Error('密码长度至少6位');
    }

    // 检查用户名是否存在
    if (await this.usernameExists(username)) {
      throw new Error('用户名已存在');
    }

    // 生成密码哈希
    const passwordHash = await hashPasswordWithSalt(password);

    // 获取现有用户
    const users = this.getUsers();

    // 创建新用户
    const newUser: UserInfo & { passwordHash: string } = {
      username,
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    // 保存用户
    users.push(newUser);
    localStorage.setItem(this.storageKey, JSON.stringify(users));

    return { username, createdAt: newUser.createdAt };
  }

  async login(username: string, password: string): Promise<UserSession> {
    if (!username || !password) {
      throw new Error('用户名和密码不能为空');
    }

    // 获取用户
    const users = this.getUsers();
    const user = users.find((u) => u.username === username);

    if (!user) {
      throw new Error('用户不存在');
    }

    // 验证密码
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw new Error('密码错误');
    }

    // 获取设备信息
    const deviceId = this.getDeviceId();
    const deviceName = this.getDeviceName();

    // 创建会话
    const session: UserSession = {
      username,
      deviceName,
      deviceId,
      lastLogin: Date.now(),
    };

    // 保存会话
    localStorage.setItem(this.sessionKey, JSON.stringify(session));

    return session;
  }

  async logout(): Promise<void> {
    localStorage.removeItem(this.sessionKey);
  }

  getCurrentUser(): UserSession | null {
    const session = localStorage.getItem(this.sessionKey);
    if (!session) return null;

    try {
      return JSON.parse(session);
    } catch {
      return null;
    }
  }

  async usernameExists(username: string): Promise<boolean> {
    const users = this.getUsers();
    return users.some((u) => u.username === username);
  }

  // === 私有辅助方法 ===

  private getUsers(): Array<UserInfo & { passwordHash: string }> {
    const stored = localStorage.getItem(this.storageKey);
    if (!stored) return [];

    try {
      return JSON.parse(stored);
    } catch {
      return [];
    }
  }

  private getDeviceId(): string {
    const stored = localStorage.getItem('exomind:deviceId');
    if (stored) return stored;

    const newId = crypto.randomUUID();
    localStorage.setItem('exomind:deviceId', newId);
    return newId;
  }

  private getDeviceName(): string {
    const stored = localStorage.getItem('exomind:deviceName');
    if (stored) return stored;

    const platform = navigator.platform;
    return `${platform} Device`;
  }
}
```

---

## 6. sync-store.ts 重构

### 6.1 重构后职责

```typescript
// 重构后的 sync-store.ts

interface SyncState {
  // 只保留 UI 状态
  status: SyncStatus;
  isLoggedIn: boolean;
  currentUser: string | null;
  conflicts: Conflict[];

  // Actions（委托给 Service）
  setStatus: (status: Partial<SyncStatus>) => void;

  // 用户相关委托给 IUserService
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;

  // 同步相关委托给 ISyncPort
  connect: (url: string) => Promise<void>;
  disconnect: () => Promise<void>;
  syncEvents: () => Promise<SyncResult>;
  syncConfig: () => Promise<SyncResult>;
}

// 实现
{
  async login(username: string, password: string) {
    // 委托给 UserService
    await userService.login(username, password);

    // 只更新 UI 状态
    set({
      isLoggedIn: true,
      currentUser: username,
    });
  },
}
```

### 6.2 渐进式重构方案

**阶段 1：创建 Service 层（推荐先做）**

```
1. 创建 src/services/interfaces/user.service.ts
2. 创建 src/services/impl/user.service.impl.ts
3. sync-store.ts 保持不变，集成 Service
```

**阶段 2：拆分 Store（可选）**

```
1. 创建 src/ui/stores/user-store.ts
2. 创建 src/ui/stores/sync-store.ts
3. 拆分后组件按需使用
```

---

## 7. 数据存储结构

### 7.1 用户数据

```typescript
// localStorage key: 'exomind:users'

[
  {
    "username": "alice",
    "passwordHash": "AbCdEfGhIjKlMnOp:8d969eef6ecad3c29a...",
    "createdAt": "2024-01-15T10:30:00Z"
  },
  {
    "username": "bob",
    "passwordHash": "xyzABC123:...",
    "createdAt": "2024-01-16T14:20:00Z"
  }
]
```

### 7.2 会话数据

```typescript
// localStorage key: 'exomind:currentUser'

{
  "username": "alice",
  "deviceName": "Windows Device",
  "deviceId": "550e8400-e29b-41d4-a716-446655440000",
  "lastLogin": 1705315800000
}
```

---

## 8. 测试设计

### 8.1 单元测试

```typescript
// tests/sync/user.service.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { UserServiceImpl } from '@/services/impl/user.service.impl';

describe('UserService', () => {
  let service: UserServiceImpl;

  beforeEach(() => {
    service = new UserServiceImpl();
    // 清理 localStorage
    localStorage.clear();
  });

  describe('register', () => {
    it('应该正确注册用户', async () => {
      const user = await service.register('alice', 'password123');

      expect(user.username).toBe('alice');
      expect(user.createdAt).toBeDefined();
    });

    it('相同用户名应该抛出错误', async () => {
      await service.register('alice', 'password123');

      await expect(
        service.register('alice', 'differentPassword')
      ).rejects.toThrow('用户名已存在');
    });

    it('密码应该被哈希存储', async () => {
      await service.register('alice', 'password123');

      const users = JSON.parse(localStorage.getItem('exomind:users') || '[]');
      const alice = users.find((u: any) => u.username === 'alice');

      // 密码不应该以明文存储
      expect(alice.passwordHash).not.toBe('password123');
      // 哈希格式应该是 salt:hash
      expect(alice.passwordHash).toContain(':');
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await service.register('alice', 'password123');
    });

    it('正确密码应该登录成功', async () => {
      const session = await service.login('alice', 'password123');

      expect(session.username).toBe('alice');
      expect(session.deviceId).toBeDefined();
    });

    it('错误密码应该抛出错误', async () => {
      await expect(
        service.login('alice', 'wrongPassword')
      ).rejects.toThrow('密码错误');
    });

    it('不存在的用户应该抛出错误', async () => {
      await expect(
        service.login('bob', 'password123')
      ).rejects.toThrow('用户不存在');
    });
  });

  describe('logout', () => {
    it('应该清除会话', async () => {
      await service.register('alice', 'password123');
      await service.login('alice', 'password123');

      await service.logout();

      expect(service.getCurrentUser()).toBeNull();
    });
  });
});
```

---

## 9. 验收标准

### 9.1 功能验收

| 用例 | 验收条件 |
|------|----------|
| 注册用户 | 用户名唯一性检查，密码哈希存储 |
| 用户登录 | 正确密码验证，错误密码拒绝 |
| 用户登出 | 会话清除 |
| 状态恢复 | 页面刷新后登录状态保持 |

### 9.2 架构验收

| 检查项 | 验收条件 |
|--------|----------|
| 职责分离 | sync-store 不包含业务逻辑 |
| 接口隔离 | L3 Service 接口独立定义 |
| 类型复用 | 复用 crypto.port.ts 中的类型 |
| 可测试 | Service 层可独立单元测试 |

---

## 10. 实施计划

### 10.1 推荐步骤

```
[阶段 1] 创建 Service 层
├── 1.1 创建 user.service.ts 接口
├── 1.2 创建 user.service.impl.ts 实现
├── 1.3 编写单元测试
└── 1.4 代码审查

[阶段 2] 重构 sync-store.ts
├── 2.1 集成 UserService
├── 2.2 移除重复的业务逻辑
└── 2.3 验证功能正常

[阶段 3] 可选拆分
├── 3.1 创建独立的 user-store.ts
├── 3.2 拆分组件依赖
└── 3.3 清理代码
```

### 10.2 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 功能回归 | 阶段 2 前确保测试覆盖 |
| 性能影响 | Service 使用单例，避免重复初始化 |
| localStorage 兼容 | 保留现有数据格式 |

---

## 11. 相关文档

| 文档 | 路径 |
|------|------|
| 密码哈希模块 | `SPEC-302-密码哈希模块.md` |
| sync 模块架构 | `SPEC-303-sync模块架构.md` |
| sync-port 接口 | `src/environment/interfaces/sync.port.ts` |
| crypto-port 接口 | `src/environment/interfaces/crypto.port.ts` |

# 用户认证模块规格

> **合并自**: SPEC-304（用户认证模块重构，19K）+ SPEC-302（密码哈希模块，15K）
>
> 本文档是 ExoMind 用户认证模块的权威规格，涵盖认证架构重构、密码哈希实现、Service 层设计与验收标准。

---

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

当前已正确使用哈希存储，但需要确认密码哈希模块的完整实现。

---

## 2. 目标

| 目标 | 说明 |
|------|------|
| 职责分离 | sync-store 只管 UI 状态，用户逻辑抽取到 L3 Service |
| 接口隔离 | L3 Service 通过接口定义，L4 通过接口使用 |
| 可测试 | 用户认证逻辑可独立单元测试 |
| 可复用 | 用户 Service 可被不同 UI 组件使用 |
| 安全性 | 使用 SHA-256 + salt 防止彩虹表攻击 |
| 一致性 | 前端（Web Crypto API）与后端（Node.js crypto）使用相同算法 |

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
│  │ - 用户注册        │        │ (L1 Adapter)             │   │
│  │ - 用户登录        │        │ - hashPassword           │   │
│  │ - 会话管理        │        │ - verifyPassword         │   │
│  └──────────────────┘        │ - generateSalt           │   │
│                               └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  L2 Environment                                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  ICryptoPort (已定义)                                   │  │
│  │  ├── generateSalt(): string                             │  │
│  │  ├── sha256(message): Promise<string>                   │  │
│  │  ├── hashPassword(password, salt): Promise<string>      │  │
│  │  └── verifyPassword(password, stored): Promise<boolean> │  │
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
│   └── crypto-adapter.ts       # [已存在] 密码哈希 + AES-256 实现
│
├── services/
│   ├── interfaces/
│   │   └── user.service.ts    # IUserService 接口
│   └── impl/
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
    ├── crypto.test.ts           # [扩展] 密码哈希测试
    └── user.service.test.ts    # [新增] 用户服务测试
```

---

## 4. 密码哈希设计

### 4.1 哈希格式

```
存储格式: salt:hash

示例:
  salt:     "AbCdEfGhIjKlMnOp"
  password: "myPassword123"
  hash:     SHA-256("AbCdEfGhIjKlMnOp" + "myPassword123")
  stored:   "AbCdEfGhIjKlMnOp:8d969eef6ecad3c29a3a629280e686cf..."
```

**为什么用这个格式？**
- `salt:hash` 格式自包含，验证时直接分割即可
- salt 暴露不影响安全（关键是不可预测）
- 便于前后端统一验证逻辑

### 4.2 核心函数

```typescript
// src/adapters/crypto-adapter.ts

// 生成随机盐（Base64 编码）
export function generateSalt(length: number = 16): string;

// SHA-256 哈希（十六进制）
export async function sha256(message: string): Promise<string>;

// 带盐哈希密码 → "salt:hash"
export async function hashPassword(password: string, salt: string): Promise<string>;

// 验证密码
export async function verifyPassword(password: string, stored: string): Promise<boolean>;
```

### 4.3 CryptoAdapter 类

```typescript
export class CryptoAdapter implements ICryptoPort {
  // === 现有 AES-256-GCM 方法 ===

  // === 密码哈希方法 ===
  generateSalt(length?: number): string;
  async sha256(message: string): Promise<string>;
  async hashPassword(password: string, salt: string): Promise<string>;
  async verifyPassword(password: string, stored: string): Promise<boolean>;
}
```

---

## 5. IUserService 接口

```typescript
// src/services/interfaces/user.service.ts

export interface IUserService {
  register(username: string, password: string): Promise<UserInfo>;
  login(username: string, password: string): Promise<UserSession>;
  logout(): Promise<void>;
  getCurrentUser(): UserSession | null;
  usernameExists(username: string): Promise<boolean>;
}

export interface UserInfo {
  username: string;
  createdAt: string;
}

export interface UserSession {
  username: string;
  deviceName: string;
  deviceId: string;
  lastLogin: number;
}
```

---

## 6. UserServiceImpl 实现

```typescript
// src/services/impl/user.service.impl.ts

export class UserServiceImpl implements IUserService {
  private crypto: CryptoAdapter;
  private storageKey = 'exomind:users';
  private sessionKey = 'exomind:currentUser';

  async register(username: string, password: string): Promise<UserInfo> {
    // 验证输入（用户名非空、密码 >= 6 位、用户名唯一）
    // 生成密码哈希（generateSalt + hashPassword）
    // 保存到 localStorage
  }

  async login(username: string, password: string): Promise<UserSession> {
    // 验证输入 → 查找用户 → 验证密码（verifyPassword）
    // 创建会话 → 保存到 localStorage
  }

  async logout(): Promise<void> { /* 清除 sessionKey */ }
  getCurrentUser(): UserSession | null { /* 读取 sessionKey */ }
  async usernameExists(username: string): Promise<boolean> { /* 查询用户列表 */ }
}
```

---

## 7. sync-store.ts 重构

### 7.1 重构后职责

```typescript
// 重构后的 sync-store.ts - 只保留 UI 状态
interface SyncState {
  status: SyncStatus;
  isLoggedIn: boolean;
  currentUser: string | null;
  conflicts: Conflict[];

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
```

### 7.2 渐进式重构方案

**阶段 1：创建 Service 层（推荐先做）**
1. 创建 `src/services/interfaces/user.service.ts`
2. 创建 `src/services/impl/user.service.impl.ts`
3. sync-store.ts 保持不变，集成 Service

**阶段 2：拆分 Store（可选）**
1. 创建 `src/ui/stores/user-store.ts`
2. 创建 `src/ui/stores/sync-store.ts`
3. 拆分后组件按需使用

---

## 8. 数据存储结构

### 8.1 用户数据

```typescript
// localStorage key: 'exomind:users'
[
  {
    "username": "alice",
    "passwordHash": "AbCdEfGhIjKlMnOp:8d969eef6ecad3c29a...",
    "createdAt": "2024-01-15T10:30:00Z"
  }
]
```

### 8.2 会话数据

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

## 9. 与后端兼容性

### 9.1 Node.js 后端实现

```javascript
// server/utils/crypto.js
function generateSalt(length = 16) { return crypto.randomBytes(length).toString('base64'); }
function sha256(message) { return crypto.createHash('sha256').update(message).digest('hex'); }
function hashPassword(password, salt) { return `${salt}:${sha256(salt + password)}`; }
function verifyPassword(password, stored) { /* 同前端逻辑 */ }
```

### 9.2 兼容性验证

| 输入 | 前端输出 | 后端输出 | 匹配 |
|------|---------|---------|------|
| salt="abc", password="123" | "abc:..." | "abc:..." | OK |
| 相同输入 | 相同输出 | 相同输出 | OK |

---

## 10. 测试设计

### 10.1 密码哈希测试

```typescript
describe('密码哈希', () => {
  describe('generateSalt', () => {
    it('应该生成指定长度的盐');
    it('每次生成应该不同');
    it('盐应该只包含 Base64 字符');
  });

  describe('sha256', () => {
    it('应该正确计算哈希');
    it('应该正确处理空字符串');
    it('应该正确处理 Unicode');
  });

  describe('hashPassword', () => {
    it('应该生成格式正确的哈希');
    it('相同输入应该生成相同哈希');
    it('不同 salt 应该生成不同哈希');
    it('不同密码应该生成不同哈希');
  });

  describe('verifyPassword', () => {
    it('正确密码应该验证通过');
    it('错误密码应该验证失败');
    it('应该验证真实注册登录流程');
  });
});
```

### 10.2 用户服务测试

```typescript
describe('UserService', () => {
  describe('register', () => {
    it('应该正确注册用户');
    it('相同用户名应该抛出错误');
    it('密码应该被哈希存储');
  });

  describe('login', () => {
    it('正确密码应该登录成功');
    it('错误密码应该抛出错误');
    it('不存在的用户应该抛出错误');
  });

  describe('logout', () => {
    it('应该清除会话');
  });
});
```

---

## 11. 安全考虑

### 11.1 已实现

| 措施 | 说明 |
|------|------|
| 加盐 | 防止彩虹表攻击 |
| SHA-256 | 抗碰撞 |
| 随机盐 | 每次注册生成新盐 |
| 可验证格式 | `salt:hash` 自包含 |

### 11.2 限制与建议

| 当前限制 | 建议扩展 |
|---------|---------|
| 无迭代 | 可增加 PBKDF2 (100k+ 迭代) |
| 纯前端验证 | 实际认证应结合后端 |
| 无速率限制 | 后端应限制登录尝试次数 |
| 无密码强度检查 | 可增加复杂度校验 |

---

## 12. 验收标准

### 12.1 功能验收

| 用例 | 验收条件 |
|------|----------|
| 注册用户 | 用户名唯一性检查，密码哈希存储 |
| 用户登录 | 正确密码验证，错误密码拒绝 |
| 用户登出 | 会话清除 |
| 状态恢复 | 页面刷新后登录状态保持 |
| 生成盐 | 每次生成不同盐，长度正确 |
| SHA-256 | 与标准实现一致 |
| 前后端兼容 | 相同输入产生相同结果 |

### 12.2 架构验收

| 检查项 | 验收条件 |
|--------|----------|
| 职责分离 | sync-store 不包含业务逻辑 |
| 接口隔离 | L3 Service 接口独立定义 |
| 类型复用 | 复用 crypto.port.ts 中的类型 |
| 可测试 | Service 层可独立单元测试 |

---

## 13. 实施计划

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

---

## 14. 依赖清单

无新增依赖，使用浏览器原生 Web Crypto API。

---

## 15. 后续扩展

- [ ] PBKDF2 迭代增强（抗暴力破解）
- [ ] 后端速率限制
- [ ] 密码强度检查
- [ ] 密码过期机制

---

## 16. 相关文档

| 文档 | 路径 |
|------|------|
| 同步模块规格 | `docs/specs/sync.md` |
| crypto-port 接口 | `src/environment/interfaces/crypto.port.ts` |
| sync-port 接口 | `src/environment/interfaces/sync.port.ts` |

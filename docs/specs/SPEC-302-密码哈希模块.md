# SPEC-302: 密码哈希模块

## 1. 概述

### 1.1 功能描述

实现用户密码的安全哈希存储，用于用户注册和登录认证。

### 1.2 设计目标

- **安全性**: 使用 SHA-256 + salt 防止彩虹表攻击
- **一致性**: 前端（Web Crypto API）与后端（Node.js crypto）使用相同算法
- **可验证**: 格式化的哈希字符串 `"salt:hash"` 便于存储和验证

---

## 2. 架构设计

### 2.1 v4 分层定位

```
┌─────────────────────────────────────────────────────────────────┐
│  L4 UI                                                          │
│  UserManagePage / SyncTestPage                                  │
│         ↓                                                        │
│  L3 Service (可选，直接调用 Adapter)                               │
│         ↓                                                        │
│  L2 Environment                                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  ICryptoPort (Port 接口 - 已定义)                        │  │
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
│  │  └── 密码哈希实现（待完成）                               │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 文件结构

```
src/
├── adapters/
│   └── crypto-adapter.ts        # [修改] 添加密码哈希实现
│
└── environment/
    └── interfaces/
        └── crypto.port.ts       # [已存在] 接口已定义

tests/
└── sync/
    └── crypto.test.ts           # [扩展] 添加密码哈希测试
```

### 2.3 哈希格式

```
存储格式: salt:hash

示例:
  salt:     "AbCdEfGhIjKlMnOp"
  password: "myPassword123"
  hash:     SHA-256("AbCdEfGhIjKlMnOp" + "myPassword123")
  stored:   "AbCdEfGhIjKlMnOp:8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"
```

**为什么用这个格式？**
- `salt:hash` 格式自包含，验证时直接分割即可
- salt 暴露不影响安全（关键是不可预测）
- 便于前后端统一验证逻辑

---

## 3. 接口设计

### 3.1 现有接口（crypto.port.ts）

```typescript
// src/environment/interfaces/crypto.port.ts

/**
 * 生成随机盐
 *
 * @param length - 盐长度（默认 16 字节）
 * @returns Base64 编码的盐字符串
 */
generateSalt(length?: number): string;

/**
 * SHA-256 哈希
 *
 * @param message - 消息字符串
 * @returns 十六进制哈希字符串
 */
sha256(message: string): Promise<string>;

/**
 * 带盐哈希密码
 *
 * @param password - 原始密码
 * @param salt - 盐值
 * @returns 格式化的哈希字符串 "salt:hash"
 */
hashPassword(password: string, salt: string): Promise<string>;

/**
 * 验证密码
 *
 * @param password - 原始密码
 * @param stored - 存储的格式化哈希字符串
 * @returns 是否匹配
 */
verifyPassword(password: string, stored: string): Promise<boolean>;
```

---

## 4. 实现设计

### 4.1 核心函数

```typescript
// src/adapters/crypto-adapter.ts

/**
 * 生成随机盐
 *
 * @param length - 盐长度（字节数，默认 16）
 * @returns Base64 编码的盐字符串
 */
export function generateSalt(length: number = 16): string {
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);

  // Base64 编码
  const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';

  // 每 3 字节转换为 4 个 Base64 字符
  for (let i = 0; i < randomBytes.length; i += 3) {
    const byte1 = randomBytes[i];
    const byte2 = randomBytes[i + 1] ?? 0;
    const byte3 = randomBytes[i + 2] ?? 0;

    const char1 = base64Chars[byte1 >> 2];
    const char2 = base64Chars[((byte1 & 0x03) << 4) | (byte2 >> 4)];
    const char3 = base64Chars[((byte2 & 0x0f) << 2) | (byte3 >> 6)];
    const char4 = base64Chars[byte3 & 0x3f];

    // 填充 '=' 如果字节不足
    result += char1;
    result += char2;
    result += i + 1 < randomBytes.length ? char3 : '=';
    result += i + 2 < randomBytes.length ? char4 : '=';
  }

  return result;
}

/**
 * SHA-256 哈希
 *
 * @param message - 消息字符串
 * @returns 十六进制哈希字符串
 */
export async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const msgBuffer = encoder.encode(message);

  // 使用 Web Crypto API 计算 SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));

  // 转换为十六进制字符串
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 带盐哈希密码
 *
 * @param password - 原始密码
 * @param salt - 盐值
 * @returns 格式化的哈希字符串 "salt:hash"
 */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const hash = await sha256(salt + password);
  return `${salt}:${hash}`;
}

/**
 * 验证密码
 *
 * @param password - 原始密码
 * @param stored - 存储的格式化哈希字符串
 * @returns 是否匹配
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt] = stored.split(':');
  const computedHash = await sha256(salt + password);
  return `${salt}:${computedHash}` === stored;
}
```

### 4.2 CryptoAdapter 扩展

```typescript
// src/adapters/crypto-adapter.ts

export class CryptoAdapter implements ICryptoPort {
  // === 现有 AES-256-GCM 方法 ===

  // === 新增密码哈希方法 ===

  generateSalt(length?: number): string {
    return generateSalt(length);
  }

  async sha256(message: string): Promise<string> {
    return sha256(message);
  }

  async hashPassword(password: string, salt: string): Promise<string> {
    return hashPassword(password, salt);
  }

  async verifyPassword(password: string, stored: string): Promise<boolean> {
    return verifyPassword(password, stored);
  }
}
```

---

## 5. 使用示例

```typescript
// 前端使用示例
const crypto = new CryptoAdapter();

// 注册用户
const salt = crypto.generateSalt(16);  // "AbCdEfGhIjKlMnOp..."
const passwordHash = await crypto.hashPassword('myPassword123', salt);

// 存储到本地 (实际项目中存储到 PouchDB)
localStorage.setItem('user:alice:password', passwordHash);

// 登录验证
const storedHash = localStorage.getItem('user:alice:password');
const isValid = await crypto.verifyPassword('myPassword123', storedHash);

if (isValid) {
  console.log('密码正确，登录成功');
} else {
  console.log('密码错误');
}
```

---

## 6. 测试用例

```typescript
// tests/sync/crypto.test.ts

describe('密码哈希', () => {
  let crypto: CryptoAdapter;

  beforeEach(() => {
    crypto = new CryptoAdapter();
  });

  describe('generateSalt', () => {
    it('应该生成指定长度的盐', () => {
      const salt16 = crypto.generateSalt(16);
      const salt32 = crypto.generateSalt(32);

      // Base64 编码后长度约为 4/3 * n，向上取整
      expect(salt16.length).toBeGreaterThanOrEqual(16);
      expect(salt32.length).toBeGreaterThanOrEqual(32);
    });

    it('每次生成应该不同', () => {
      const salt1 = crypto.generateSalt();
      const salt2 = crypto.generateSalt();

      expect(salt1).not.toBe(salt2);
    });

    it('盐应该只包含 Base64 字符', () => {
      const salt = crypto.generateSalt(16);
      const base64Regex = /^[A-Za-z0-9+/]+=*$/;

      // 移除填充字符后验证
      expect(salt.replace(/=+$/, '')).toMatch(base64Regex);
    });
  });

  describe('sha256', () => {
    it('应该正确计算哈希', async () => {
      const hash = await crypto.sha256('hello');

      // SHA-256("hello") 的已知值
      expect(hash).toBe(
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
      );
    });

    it('应该正确处理空字符串', async () => {
      const hash = await crypto.sha256('');

      // SHA-256("") 的已知值
      expect(hash).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      );
    });

    it('应该正确处理 Unicode', async () => {
      const hash = await crypto.sha256('你好世界');

      // 应该返回 64 字符的十六进制字符串
      expect(hash).toHaveLength(64);
    });
  });

  describe('hashPassword', () => {
    it('应该生成格式正确的哈希', async () => {
      const hash = await crypto.hashPassword('password', 'salt123');

      expect(hash).toContain(':');
      expect(hash.split(':')).toHaveLength(2);
    });

    it('相同输入应该生成相同哈希', async () => {
      const hash1 = await crypto.hashPassword('password', 'salt123');
      const hash2 = await crypto.hashPassword('password', 'salt123');

      expect(hash1).toBe(hash2);
    });

    it('不同 salt 应该生成不同哈希', async () => {
      const hash1 = await crypto.hashPassword('password', 'salt1');
      const hash2 = await crypto.hashPassword('password', 'salt2');

      expect(hash1).not.toBe(hash2);
    });

    it('不同密码应该生成不同哈希', async () => {
      const hash1 = await crypto.hashPassword('password1', 'salt');
      const hash2 = await crypto.hashPassword('password2', 'salt');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyPassword', () => {
    it('正确密码应该验证通过', async () => {
      const password = 'mySecretPassword';
      const salt = crypto.generateSalt(16);
      const hash = await crypto.hashPassword(password, salt);

      const isValid = await crypto.verifyPassword(password, hash);

      expect(isValid).toBe(true);
    });

    it('错误密码应该验证失败', async () => {
      const password = 'correctPassword';
      const wrongPassword = 'wrongPassword';
      const salt = crypto.generateSalt(16);
      const hash = await crypto.hashPassword(password, salt);

      const isValid = await crypto.verifyPassword(wrongPassword, hash);

      expect(isValid).toBe(false);
    });

    it('应该验证真实注册登录流程', async () => {
      // 注册
      const username = 'alice';
      const password = 'testPassword123';
      const salt = crypto.generateSalt(16);
      const storedHash = await crypto.hashPassword(password, salt);

      // 模拟存储
      localStorage.setItem(`user:${username}:password`, storedHash);

      // 登录 - 正确密码
      const savedHash = localStorage.getItem(`user:${username}:password`);
      const loginSuccess = await crypto.verifyPassword(password, savedHash!);
      expect(loginSuccess).toBe(true);

      // 登录 - 错误密码
      const loginFail = await crypto.verifyPassword('wrongPassword', savedHash!);
      expect(loginFail).toBe(false);
    });
  });
});
```

---

## 7. 与后端兼容性

### 7.1 Node.js 后端实现

```javascript
// server/utils/crypto.js

/**
 * 生成随机盐 (Base64)
 */
function generateSalt(length = 16) {
  return crypto.randomBytes(length).toString('base64');
}

/**
 * SHA-256 哈希 (十六进制)
 */
function sha256(message) {
  return crypto.createHash('sha256').update(message).digest('hex');
}

/**
 * 带盐哈希密码
 */
function hashPassword(password, salt) {
  return `${salt}:${sha256(salt + password)}`;
}

/**
 * 验证密码
 */
function verifyPassword(password, stored) {
  const [salt] = stored.split(':');
  return `${salt}:${sha256(salt + password)}` === stored;
}
```

### 7.2 兼容性验证表

| 输入 | 前端输出 | 后端输出 | 匹配 |
|------|---------|---------|------|
| salt="abc", password="123" | "abc:..." | "abc:..." | ✅ |
| salt="不同盐", password="相同" | 不同哈希 | 不同哈希 | ✅ |
| 相同输入 | 相同输出 | 相同输出 | ✅ |

---

## 8. 安全考虑

### 8.1 已实现

| 措施 | 说明 |
|------|------|
| 加盐 | 防止彩虹表攻击 |
| SHA-256 | 抗碰撞 |
| 随机盐 | 每次注册生成新盐 |

### 8.2 限制与建议

| 当前限制 | 建议扩展 |
|---------|---------|
| 无迭代 | 可增加 PBKDF2 (100k+ 迭代) |
| 纯前端验证 | 实际认证应结合后端 |
| 无速率限制 | 后端应限制登录尝试次数 |

---

## 9. 验收标准

| 用例 | 验收条件 |
|------|----------|
| 生成盐 | 每次生成不同盐，长度正确 |
| SHA-256 | 与标准实现一致 |
| 哈希密码 | 格式正确，相同输入相同输出 |
| 验证密码 | 正确密码返回 true，错误返回 false |
| 前后端兼容 | 相同输入产生相同结果 |

---

## 10. 依赖清单

无新增依赖，使用浏览器原生 Web Crypto API。

---

## 11. 后续扩展

- [ ] PBKDF2 迭代增强（抗暴力破解）
- [ ] 后端速率限制
- [ ] 密码强度检查
- [ ] 密码过期机制

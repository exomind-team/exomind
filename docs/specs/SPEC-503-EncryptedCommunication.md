# 加密通讯系统

> 每次新功能开发前必须填写此文档

## 基本信息

| 字段 | 内容 |
|------|------|
| **功能名称** | 设备间加密通讯 |
| **创建日期** | 2026-02-04 |
| **优先级** | P0 |
| **状态** | 待开发 |

---

## 1. 用户需求

### 1.1 问题描述
设备配对后，需要建立加密通讯通道，确保消息在传输过程中的机密性和完整性。

### 1.2 使用场景
- 场景1：配对成功后，双方基于 userId 生成共享密钥
- 场景2：发送消息前使用共享密钥加密
- 场景3：接收消息后使用共享密钥解密

### 1.3 期望行为
- 基于 ECDH 密钥交换协议
- 使用 AES-256-GCM 进行消息加密
- 每个配对关系有独立的共享密钥
- 支持加密消息的发送和接收

---

## 2. 功能定义

### 2.1 输入

| 参数名 | 类型 | 必需 | 默认值 | 描述 |
|--------|------|------|--------|------|
| peerId | string | 是 | - | 对方 userId |
| message | string | 是 | - | 要发送的明文 |

### 2.2 输出

| 参数名 | 类型 | 描述 |
|--------|------|------|
| encryptedMessage | string | Base64 编码的加密消息 |
| decryptedMessage | string | 解密后的明文 |

### 2.3 处理逻辑

#### 密钥生成（配对确认时）
```
配对确认
    ↓
双方各自生成 ECDH 密钥对 (公钥/私钥)
    ↓
交换公钥（通过配对会话）
    ↓
各自用对方公钥 + 自己私钥 生成共享密钥
    ↓
保存共享密钥到本地存储 (关联 peerId)
```

#### 消息加密
```
发送消息
    ↓
获取与 peerId 对应的共享密钥
    ↓
生成随机 IV (12 字节)
    ↓
使用 AES-256-GCM 加密消息
    ↓
拼接 IV + 密文 + Tag
    ↓
Base64 编码后发送
```

#### 消息解密
```
收到加密消息
    ↓
Base64 解码
    ↓
分离 IV、密文、Tag
    ↓
获取与 peerId 对应的共享密钥
    ↓
使用 AES-256-GCM 解密
    ↓
返回明文
```

---

## 3. 验收标准

- [ ] 基于 ECDH 生成共享密钥
- [ ] 使用 AES-256-GCM 加密
- [ ] 每个配对有独立共享密钥
- [ ] 加密消息格式：Base64(IV + Ciphertext + AuthTag)
- [ ] 支持加密消息的发送和接收
- [ ] 密钥本地安全存储

---

## 4. 边界条件

| 条件 | 预期行为 |
|------|---------|
| 对方未配对 | 返回 "NOT_PAIRED" 错误 |
| 共享密钥不存在 | 返回 "KEY_NOT_FOUND" 错误 |
| 加密失败 | 返回 "ENCRYPTION_FAILED" 错误 |
| 解密失败（AuthTag 验证失败） | 返回 "DECRYPTION_FAILED" 错误 |

---

## 5. 错误处理

| 错误类型 | 错误信息 | 处理方式 |
|----------|----------|----------|
| NOT_PAIRED | "未与该设备配对" | 提示先完成配对 |
| KEY_NOT_FOUND | "加密密钥不存在" | 提示重新配对 |
| ENCRYPTION_FAILED | "加密失败" | 重试或提示用户 |
| DECRYPTION_FAILED | "消息验证失败" | 丢弃消息，记录日志 |

---

## 6. 依赖关系

### 6.1 依赖模块
- SPEC-501: UserIdentity (获取本机 userId)
- SPEC-502: PairingSystem (配对完成后触发密钥生成)

### 6.2 外部依赖
- Web Crypto API (ECDH, AES-GCM)
- Tauri store (密钥存储)

---

## 7. 架构设计

### 7.1 类设计

```typescript
interface EncryptedMessage {
  version: 1;                    // 协议版本
  iv: string;                    // Base64 编码的 IV (12 字节)
  ciphertext: string;             // Base64 编码的密文
  authTag: string;               // Base64 编码的认证标签 (16 字节)
  timestamp: number;             // 发送时间戳
  senderId: string;             // 发送方 userId
}

interface CryptoService {
  /** 生成密钥对 (在配对时调用) */
  generateKeyPair(): Promise<{ publicKey: string; privateKey: string }>;

  /** 生成共享密钥 (配对确认时) */
  deriveSharedKey(peerId: string, theirPublicKey: string): Promise<void>;

  /** 加密消息 */
  encrypt(peerId: string, plaintext: string): Promise<string>;

  /** 解密消息 */
  decrypt(peerId: string, encryptedMessage: string): Promise<string>;

  /** 验证能否与该 peer 通讯 */
  canCommunicate(peerId: string): Promise<boolean>;

  /** 删除与 peer 的密钥 (取消配对时) */
  deleteSharedKey(peerId: string): Promise<void>;
}
```

### 7.2 数据流

```
配对确认
    ↓
generateKeyPair() → 生成密钥对
    ↓
交换公钥 → deriveSharedKey(theirPublicKey)
    ↓
保存共享密钥 (索引: peerId)
    ↓
通讯时: encrypt(peerId, message) / decrypt(peerId, encrypted)
```

### 7.3 状态变化

```
NO_KEY → (deriveSharedKey) → KEY_ESTABLISHED → (deleteSharedKey) → NO_KEY
```

---

## 8. 测试用例

### 8.1 单元测试

| 用例 | 输入 | 预期输出 |
|------|------|----------|
| 生成密钥对 | generateKeyPair() | 公钥和私钥 |
| 派生共享密钥 | deriveSharedKey() | 无异常 |
| 加密消息 | encrypt(peerId, msg) | Base64 字符串 |
| 解密消息 | decrypt(peerId, encrypted) | 原始明文 |
| 加密解密一致性 | encrypt → decrypt | 输入 === 输出 |
| 篡改验证 | 修改 authTag | 解密失败 |

### 8.2 集成测试

| 用例 | 描述 | 预期结果 |
|------|------|----------|
| 两设备配对加密 | A 生成密钥 → B 生成密钥 → 交换 → 双方派生 | 双方得到相同共享密钥 |
| 加密消息传输 | A 加密 → 发送 → B 解密 | 消息正确还原 |

---

## 9. 文档更新

- [ ] 更新 README.md（安全机制说明）
- [ ] 更新 API.md

---

## 10. 实施计划

### Step 1: 创建 src/lib/crypto/crypto-types.ts
- [ ] 定义加密消息接口

### Step 2: 创建 src/lib/crypto/crypto-service.ts
- [ ] 实现密钥生成和派生
- [ ] 实现 AES-256-GCM 加解密

### Step 3: 添加单元测试
- [ ] 覆盖所有边界条件

### Step 4: 验证测试
- [ ] 运行测试确保 100% 通过

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-02-04 | 1.0 | 初始版本 | Claude |

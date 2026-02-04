# SPEC-503: 加密通讯模块

> 版本: v1.0.0
> 优先级: P0（核心功能）
> 状态: Draft
> 创建日期: 2026-02-04

## 1. 功能定义

本模块实现端到端加密通讯，采用 ECDH 密钥交换 + AES-256-GCM 加密算法。

## 2. 设计理由

- **ECDH (P-256)**: 前向安全的密钥交换协议
- **AES-256-GCM**: 高性能对称加密，提供认证加密
- **GCM 模式**: 集成认证标签，防止篡改

## 3. 规格

### 3.1 密钥交换（ECDH P-256）

| 参数 | 值 |
|------|-----|
| 曲线 | P-256 (secp256r1) |
| 公钥格式 | Base64 编码 |
| 私钥存储 | Tauri Store |

### 3.2 对称加密（AES-256-GCM）

| 参数 | 值 |
|------|-----|
| 密钥长度 | 256 位 |
| IV 长度 | 12 字节（96 位） |
| 认证标签 | 16 字节（128 位） |
| 密文格式 | Base64 编码 |

### 3.3 消息格式

```typescript
interface EncryptedMessage {
  version: 1;           // 格式版本
  iv: string;           // Base64，12 字节
  ciphertext: string;   // Base64，加密后数据
  authTag: string;      // Base64，16 字节
  timestamp: number;    // Unix 时间戳
  senderId: string;     // 发送者 User ID
}
```

### 3.4 持久化

- **密钥对**: `crypto.keypair`
- **共享密钥**: `crypto.shared.{peerId}`

## 4. 接口定义

```typescript
interface ICryptoService {
  /** 生成 ECDH 密钥对 */
  generateKeyPair(): Promise<string>;  // 返回公钥（Base64）

  /** 导出私钥（Base64） */
  exportPrivateKey(): Promise<string>;

  /** 导入私钥 */
  importPrivateKey(privateKey: string): Promise<void>;

  /** 派生共享密钥 */
  deriveSharedKey(peerId: string, theirPublicKey: string): Promise<void>;

  /** 加密消息 */
  encrypt(peerId: string, plaintext: string): Promise<string>;  // Base64(JSON)

  /** 解密消息 */
  decrypt(peerId: string, encryptedMessage: string): Promise<string>;

  /** 检查是否可以与对方通讯 */
  canCommunicate(peerId: string): Promise<boolean>;

  /** 删除共享密钥 */
  deleteSharedKey(peerId: string): Promise<void>;

  /** 删除本地密钥对 */
  deleteKeyPair(): Promise<void>;
}
```

## 5. 验收标准

| 场景 | 输入 | 预期输出 |
|------|------|----------|
| 生成密钥对 | 无 | P-256 公钥（Base64） |
| 密钥派生 | 对方公钥 | 共享密钥（存储） |
| 加密消息 | `peerId: "abc"`, `"hello"` | Base64 字符串 |
| 解密消息 | 加密消息 | 原文 `"hello"` |
| 验证格式 | 任意加密消息 | 包含 version, iv, ciphertext, authTag, timestamp, senderId |
| 密钥删除 | `peerId` | 清除存储的共享密钥 |

## 6. 依赖关系

```
UserIdService → PairingService → CryptoService
```

## 7. 测试用例

### 7.1 单元测试

```typescript
describe('CryptoService', () => {
  describe('generateKeyPair', () => {
    it('should generate valid ECDH public key', async () => {
      const publicKey = await service.generateKeyPair();
      expect(publicKey).toMatch(/^[A-Za-z0-9+/=]+$/);
    });
  });

  describe('encrypt/decrypt', () => {
    it('should encrypt and decrypt message', async () => {
      await service.deriveSharedKey('peer1', peerPublicKey);
      const encrypted = await service.encrypt('peer1', 'hello');
      const decrypted = await service.decrypt('peer1', encrypted);
      expect(decrypted).toBe('hello');
    });
  });
});
```

## 8. 风险与缓解

| 风险 | 级别 | 缓解措施 |
|------|------|----------|
| 私钥泄露 | 高 | 存储在 Tauri Store（系统级加密） |
| 前向安全 | 中 | 每次会话生成新密钥对 |
| 密钥回滚 | 低 | 版本号机制，支持密钥轮换 |

## 9. 实现任务

- [ ] 定义 Crypto 类型（types.ts）
- [ ] 实现 `CryptoService` 类
- [ ] 实现 ECDH 密钥生成和交换
- [ ] 实现 AES-256-GCM 加解密
- [ ] 实现 Tauri Store 集成
- [ ] 编写单元测试（100% 覆盖）

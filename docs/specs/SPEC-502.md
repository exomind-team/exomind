# SPEC-502: 配对码系统

> 版本: v1.0.0
> 优先级: P0（核心功能）
> 状态: Draft
> 创建日期: 2026-02-04

## 1. 功能定义

本模块实现设备间的配对流程，使用 6 位数字配对码建立两个用户之间的信任关系。

## 2. 设计理由

- **6 位数字**: 100 万种组合，足够安全
- **5 分钟有效期**: 平衡安全性和用户体验
- **3 次尝试限制**: 防止暴力破解
- **锁定机制**: 连续失败后锁定 1 分钟

## 3. 规格

### 3.1 配对码格式

| 字段 | 格式 | 说明 |
|------|------|------|
| 长度 | 6 位 | 000000 - 999999 |
| 字符集 | 纯数字 | |
| 有效期 | 5 分钟 | 300 秒 |
| 最大尝试 | 3 次 | |

### 3.2 配对状态机

```
idle → pending → confirmed
               → expired
               → cancelled
               → failed (max attempts)
```

### 3.3 生成算法

```typescript
function generatePairingCode(): string {
  // 生成 3 字节随机数，映射到 000000-999999
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const num = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
  return (num % 1000000).toString().padStart(6, '0');
}
```

### 3.4 持久化

- **配对会话**: `pairing.session`
- **锁定状态**: `pairing.lock`

## 4. 接口定义

```typescript
interface IPairingService {
  /** 开始配对流程，返回配对码 */
  startPairing(): Promise<PairingResult>;

  /** 确认配对（输入配对码） */
  confirmPairing(code: string): Promise<ConfirmResult>;

  /** 取消当前配对 */
  cancelPairing(): Promise<void>;

  /** 获取当前配对状态 */
  getPairingStatus(): Promise<PairingSession | null>;

  /** 检查是否有待确认的配对 */
  hasPendingPairing(): Promise<boolean>;
}

type PairingStatus = 'idle' | 'pending' | 'confirmed' | 'cancelled' | 'expired';

interface PairingResult {
  pairingId: string;
  code: string;        // 6 位配对码
  expiresAt: number;   // Unix 时间戳
}

interface PairingSession {
  pairingId: string;
  code: string;
  initiatorId: string;
  responderId?: string;
  status: PairingStatus;
  expiresAt: number;
  attempts: number;
}

interface ConfirmResult {
  success: boolean;
  pairedUserId?: string;
  error?: PairingErrorType;
}

type PairingErrorType =
  | 'PAIRING_NOT_FOUND'
  | 'PAIRING_EXPIRED'
  | 'PAIRING_ALREADY_CONFIRMED'
  | 'INVALID_CODE'
  | 'MAX_ATTEMPTS_EXCEEDED'
  | 'ALREADY_PENDING';
```

## 5. 验收标准

| 场景 | 输入 | 预期输出 |
|------|------|----------|
| 生成配对码 | 无 | 6 位数字字符串，有效期 5 分钟 |
| 正确确认 | 正确配对码 | success: true, pairedUserId |
| 错误尝试 | 错误配对码 | attempts 增加 |
| 3 次错误 | 错误配对码 | 锁定 1 分钟 |
| 已过期 | 过期配对码 | PAIRING_EXPIRED 错误 |
| 重复确认 | 已确认配对码 | PAIRING_ALREADY_CONFIRMED |
| 取消配对 | 无 | 清除配对会话 |

## 6. 依赖关系

```
UserIdService → PairingService → CryptoService
```

## 7. 测试用例

### 7.1 单元测试

```typescript
describe('PairingService', () => {
  describe('startPairing', () => {
    it('should generate 6-digit code', async () => {
      const result = await service.startPairing();
      expect(result.code).toMatch(/^\d{6}$/);
    });

    it('should reject if pending pairing exists', async () => {
      // Mock pending session
      await expect(service.startPairing()).rejects.toThrow('ALREADY_PENDING');
    });
  });

  describe('confirmPairing', () => {
    it('should confirm with correct code', async () => {
      const result = await service.confirmPairing('123456');
      expect(result.success).toBe(true);
    });

    it('should reject wrong code', async () => {
      const result = await service.confirmPairing('000000');
      expect(result.error).toBe('INVALID_CODE');
    });
  });
});
```

## 8. 风险与缓解

| 风险 | 级别 | 缓解措施 |
|------|------|----------|
| 暴力破解 | 中 | 3 次尝试限制 + 1 分钟锁定 |
| 配对码猜测 | 低 | 100 万种组合，5 分钟过期 |
| 中间人攻击 | 中 | 后续 ECDH 密钥交换保障 |

## 9. 实现任务

- [ ] 定义 Pairing 类型（types.ts）
- [ ] 实现 `generatePairingCode()` 函数
- [ ] 实现 `PairingService` 类
- [ ] 实现 Tauri Store 集成
- [ ] 编写单元测试（100% 覆盖）

# 配对码系统

> 每次新功能开发前必须填写此文档

## 基本信息

| 字段 | 内容 |
|------|------|
| **功能名称** | 设备配对码系统 |
| **创建日期** | 2026-02-04 |
| **优先级** | P0 |
| **状态** | 待开发 |

---

## 1. 用户需求

### 1.1 问题描述
用户需要在两台设备之间建立安全连接，使用 6 位数字配对码进行身份验证。

### 1.2 使用场景
- 场景1：设备 A 生成配对码，设备 B 输入配对码完成配对
- 场景2：配对码有效期验证，防止恶意尝试

### 1.3 期望行为
- 生成 6 位随机数字配对码
- 配对码有效期 5 分钟
- 同一时间只允许一个待确认配对
- 配对成功后双方记录对方身份

---

## 2. 功能定义

### 2.1 输入

| 参数名 | 类型 | 必需 | 默认值 | 描述 |
|--------|------|------|--------|------|
| 无 | - | - | - | 自动生成，无需输入 |

### 2.2 输出

| 参数名 | 类型 | 描述 |
|--------|------|------|
| pairingCode | string | 6 位数字字符串 |
| pairingId | string | 配对会话 ID |

### 2.3 处理逻辑

#### 生成配对码
```
用户请求配对
    ↓
生成 6 位随机数字 (000000-999999)
    ↓
生成 pairingId (UUID v4)
    ↓
创建配对会话 { pairingId, code, expiresAt, status: pending }
    ↓
返回 { pairingId, code }
```

#### 验证配对码
```
用户输入 6 位配对码
    ↓
验证配对码格式 (6 位数字)
    ↓
查找对应的配对会话
    ↓
验证：格式正确 + 会话存在 + 未过期 + 状态 pending
    ↓
验证通过 → 更新会话状态为 confirmed → 双方建立信任关系
    ↓
验证失败 → 返回错误
```

---

## 3. 验收标准

- [ ] 生成 6 位数字配对码
- [ ] 配对码有效期 5 分钟
- [ ] 同一时间只允许一个待确认配对
- [ ] 配对码验证防暴力尝试（最多 3 次）
- [ ] 配对成功后双方保存对方 userId
- [ ] 提供取消配对的接口

---

## 4. 边界条件

| 条件 | 预期行为 |
|------|---------|
| 配对码过期 | 返回 "PAIRING_EXPIRED" 错误 |
| 配对码错误 | 返回 "INVALID_CODE" 错误，记录尝试次数 |
| 已有待确认配对 | 拒绝新配对请求，返回 "PAIRING_IN_PROGRESS" |
| 尝试次数超限 | 锁定配对 1 分钟 |

---

## 5. 错误处理

| 错误类型 | 错误信息 | 处理方式 |
|----------|----------|----------|
| PAIRING_EXPIRED | "配对码已过期" | 提示用户请求新配对码 |
| INVALID_CODE | "配对码错误" | 提示剩余尝试次数 |
| PAIRING_IN_PROGRESS | "已有待确认配对" | 提示先取消或等待完成 |
| MAX_ATTEMPTS_EXCEEDED | "尝试次数过多" | 锁定 1 分钟 |

---

## 6. 依赖关系

### 6.1 依赖模块
- SPEC-501: UserIdentity (获取本机 userId)
- Tauri store (配对会话存储)

### 6.2 外部依赖
- UUID 生成库
- 计时器/超时处理

---

## 7. 架构设计

### 7.1 类设计

```typescript
interface PairingSession {
  pairingId: string;       // 配对会话 ID
  code: string;            // 6 位配对码
  initiatorId: string;     // 发起方 userId
  responderId?: string;    // 响应方 userId (确认后填充)
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired';
  expiresAt: number;      // 过期时间戳
  attempts: number;        // 尝试次数
}

interface PairingService {
  /** 开始配对，返回配对码 */
  startPairing(): Promise<{ pairingId: string; code: string }>;

  /** 确认配对 */
  confirmPairing(code: string): Promise<{ pairedUserId: string }>;

  /** 取消配对 */
  cancelPairing(): Promise<void>;

  /** 获取当前配对状态 */
  getPairingStatus(): Promise<PairingSession | null>;

  /** 检查是否有待确认的配对 */
  hasPendingPairing(): Promise<boolean>;
}
```

### 7.2 数据流

#### 发起方流程
```
startPairing() → 生成配对码和会话 → 返回 code
    ↓
等待确认
    ↓
(另一方 confirmPairing) → 双方建立信任 → 配对完成
```

#### 响应方流程
```
confirmPairing(code) → 验证配对码 → 绑定双方 ID → 双方保存信任关系
```

### 7.3 状态变化

```
IDLE → (startPairing) → PENDING → (confirmPairing) → CONFIRMED
                              ↓ (cancelPairing)     ↓
                              CANCELLED             IDLE
                              ↓ (超时)
                              EXPIRED
```

---

## 8. 测试用例

### 8.1 单元测试

| 用例 | 输入 | 预期输出 |
|------|------|----------|
| 生成配对码 | startPairing() | 6 位数字字符串 |
| 配对码格式 | code | /^\d{6}$/ |
| 确认有效配对 | 正确 code | confirmed 状态 |
| 拒绝无效配对 | 错误 code | INVALID_CODE 错误 |
| 配对过期 | 过期 code | PAIRING_EXPIRED 错误 |
| 重复确认 | 已 confirmed | ALREADY_PAIRED 错误 |

### 8.2 集成测试

| 用例 | 描述 | 预期结果 |
|------|------|----------|
| 完整配对流程 | A 发起 → B 确认 | 双方互相保存信任 |

---

## 9. 文档更新

- [ ] 更新 README.md（配对流程说明）
- [ ] 更新 API.md

---

## 10. 实施计划

### Step 1: 创建 src/lib/pairing/pairing-types.ts
- [ ] 定义配对会话接口

### Step 2: 创建 src/lib/pairing/pairing-service.ts
- [ ] 实现配对逻辑
- [ ] 添加验证和过期处理

### Step 3: 添加单元测试
- [ ] 覆盖所有边界条件

### Step 4: 验证测试
- [ ] 运行测试确保 100% 通过

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-02-04 | 1.0 | 初始版本 | Claude |

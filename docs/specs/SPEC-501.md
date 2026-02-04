# SPEC-501: 用户 ID 生成模块

> 版本: v1.0.0
> 优先级: P0（核心依赖）
> 状态: Draft
> 创建日期: 2026-02-04

## 1. 功能定义

本模块负责生成和管理用户的唯一标识符（User ID），采用 32 位十六进制字符串格式，确保全球唯一性。

## 2. 设计理由

- **32 位十六进制**: 128 位熵，碰撞概率可忽略
- **本地生成**: 不依赖服务器生成，支持离线场景
- **持久化存储**: 用户身份跨会话保持

## 3. 规格

### 3.1 User ID 格式

| 字段 | 格式 | 说明 |
|------|------|------|
| 长度 | 32 字符 | 128 位 = 16 字节 |
| 编码 | 十六进制 | 小写字母 |
| 示例 | `a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4` | |

### 3.2 生成算法

```typescript
function generateUserId(): string {
  // 使用 crypto.getRandomValues 生成 16 字节随机数
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
```

### 3.3 持久化

- **存储键**: `user.identity`
- **存储后端**: Tauri Store（插件）

## 4. 接口定义

```typescript
interface IUserIdService {
  /** 获取当前用户 ID（自动生成或读取已存储） */
  getUserId(): Promise<string>;

  /** 检查用户 ID 是否已存在 */
  hasUserId(): Promise<boolean>;

  /** 生成并保存新的用户 ID（强制覆盖） */
  generateNewId(): Promise<string>;

  /** 获取格式化后的用户 ID（XXXX-XXXX-XXXX-XXXX 格式） */
  getFormattedId(): Promise<string>;
}
```

## 5. 验收标准

| 场景 | 输入 | 预期输出 |
|------|------|----------|
| 首次调用 | 无 | 生成并返回新的 User ID |
| 重复调用 | 无 | 返回已缓存的 User ID |
| 已存在 ID | 无 | 返回已存储的 ID |
| 格式化 | `a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4` | `a1b2-c3d4-e5f6-a1b2-c3d4-e5f6-a1b2-c3d4` |
| 格式验证 | 任意 | 必须是 32 位十六进制字符串 |

## 6. 依赖关系

```
无（最底层模块）
```

## 7. 测试用例

### 7.1 单元测试

```typescript
describe('UserIdService', () => {
  it('should generate 32-char hex string', async () => {
    const id = await generateUserId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('should return stored userId if exists', async () => {
    // Mock store.get returns existing ID
    const id = await service.getUserId();
    expect(id).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4');
  });

  it('should cache userId after first call', async () => {
    // store.get called only once despite multiple getUserId calls
  });
});
```

## 8. 风险与缓解

| 风险 | 级别 | 缓解措施 |
|------|------|----------|
| 随机数生成器质量 | 低 | 使用 `crypto.getRandomValues` 而非 `Math.random` |
| ID 冲突 | 极低 | 128 位熵，碰撞概率 ~10^-38 |

## 9. 实现任务

- [ ] 实现 `generateUserId()` 函数
- [ ] 实现 `UserIdService` 类（含单例模式）
- [ ] 实现 Tauri Store 集成
- [ ] 编写单元测试（100% 覆盖）

# SPEC-901: FileStorage 存储模块重构

## 设计理由

当前存储实现缺乏统一抽象，导致：
1. 无法在 JSONL 和 SQLite 之间切换
2. 错误处理逻辑重复
3. 类型安全性不足

## 功能定义

### Storage 接口

```typescript
interface Storage<T extends Record<string, unknown> = Record<string, unknown>> {
  // CRUD 操作
  insert(entity: T): StorageResult<T>;
  find(id: string): StorageResult<T | null>;
  update(id: string, data: Partial<T>): StorageResult<void>;
  delete(id: string): StorageResult<void>;

  // 查询操作
  all(): StorageResult<T[]>;
  where(filter: Partial<T>): StorageResult<T[]>;

  // 生命周期
  close(): StorageResult<void>;
}
```

### StorageError 错误类型

```typescript
type StorageError =
  | { type: 'NOT_FOUND'; id: string }
  | { type: 'DUPLICATE_KEY'; id: string }
  | { type: 'IO_ERROR'; message: string; path?: string }
  | { type: 'PARSE_ERROR'; message: string; line?: number }
  | { type: 'VALIDATION_ERROR'; message: string; field?: string };
```

## 输入输出

| 操作 | 输入 | 输出 |
|------|------|------|
| insert | `T` | `StorageResult<T>` |
| find | `id: string` | `StorageResult<T \| null>` |
| update | `id: string, Partial<T>` | `StorageResult<void>` |
| delete | `id: string` | `StorageResult<void>` |
| all | - | `StorageResult<T[]>` |
| where | `filter: Partial<T>` | `StorageResult<T[]>` |
| close | - | `StorageResult<void>` |

## 验收标准

- [ ] Storage 接口定义完整
- [ ] JSONL 适配器实现 100% 覆盖
- [ ] 错误类型可区分、可处理
- [ ] 单元测试覆盖率 100%
- [ ] 现有代码兼容（适配器包装旧实现）

## 依赖

无外部依赖

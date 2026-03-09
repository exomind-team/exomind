# 并发仲裁覆盖问题修复报告

## 问题描述

当存在历史锁评论时，并发的 Agent A 和 Agent B 会编辑同一条评论，导致：
- 较晚写入会覆盖较早写入
- `detectConflict` 只能看到最终那一份元数据
- 仲裁结果受"最后一次写入"影响，而不是"最早时间戳"

## 根本原因

`updateLockComment` 方法会查找已存在的锁评论并复用：

```typescript
// 旧代码（有问题）
private async updateLockComment(prNumber: number, lock: LockMetadata): Promise<number | undefined> {
  // 1. 查找是否已存在锁评论
  const comments = await this.getComments(prNumber);
  const existingLockComment = comments
    .reverse()
    .find((c: any) => c.body?.includes(LOCK_METADATA_MARKER));

  if (existingLockComment) {
    // 2. 如果存在，编辑该评论 ← 问题所在
    await this.updateComment(prNumber, existingLockComment.id, body);
    return existingLockComment.id;
  } else {
    // 3. 如果不存在，创建新评论
    await this.createComment(prNumber, body);
    // ...
  }
}
```

## 修复方案

移除"查找已存在锁评论并编辑"的逻辑，总是创建新的锁评论：

```typescript
// 新代码（已修复）
private async updateLockComment(prNumber: number, lock: LockMetadata): Promise<number | undefined> {
  const body = /* ... */;

  // 总是创建新评论（不复用旧评论）
  console.log(`[PRLock] Creating new lock comment for ${lock.agent_id}`);
  await this.createComment(prNumber, body);

  // 获取刚创建的评论 ID
  const updatedComments = await this.getComments(prNumber);
  const newComment = updatedComments[updatedComments.length - 1];
  return newComment?.id;
}
```

## 修复效果

1. **独立记录**：每个 Agent 都有独立的锁评论记录
2. **完整可见**：`detectConflict` 可以看到所有并发的锁记录
3. **正确仲裁**：仲裁基于时间戳，不受写入顺序影响

## 验收标准

- [x] 并发 A/B acquire 时，每个都创建独立的锁评论
- [x] detectConflict 可以看到所有锁记录
- [x] 仲裁基于时间戳，不受写入顺序影响

## 测试脚本

创建了 `Scripts/test-concurrent-lock.ts` 用于验证修复效果：

```bash
bun Scripts/test-concurrent-lock.ts
```

## 相关文件

- `Scripts/lib/pr-lock.ts` - 修复的核心文件
- `Scripts/test-concurrent-lock.ts` - 并发测试脚本
- `Scripts/test-pr-lock.ts` - 完整测试套件

## 修复时间

2026-03-09

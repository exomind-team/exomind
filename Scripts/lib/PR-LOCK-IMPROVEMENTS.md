# PR Lock 改进说明

## 改进概述

本次改进优化了 PR Lock 机制，主要包括以下几个方面：

1. **评论编辑而非创建新评论**
2. **释放锁时编辑评论标记为已释放**
3. **锁元数据包含 Git 分支名**
4. **评论 ID 保存到本地锁文件**

---

## 详细改进

### 1. 添加编辑评论的方法

新增 `updateComment` 方法，用于编辑已存在的评论：

```typescript
private async updateComment(prNumber: number, commentId: number, body: string): Promise<void> {
  // 使用临时文件避免 shell 转义问题
  const tmpFile = `/tmp/pr-lock-comment-${Date.now()}.md`;
  await Bun.write(tmpFile, body);
  this.gh(`api repos/${this.repo}/issues/comments/${commentId} -X PATCH -f body=@${tmpFile}`);
  execSync(`rm ${tmpFile}`);
}
```

### 2. 修改 `createLockComment` 为 `updateLockComment`

新方法会：
- 首先查找是否已存在锁评论（通过 `LOCK_METADATA_MARKER` 标记识别）
- 如果存在，编辑该评论
- 如果不存在，创建新评论
- 返回评论 ID（用于后续编辑）

```typescript
private async updateLockComment(prNumber: number, lock: LockMetadata): Promise<number | undefined> {
  // 1. 查找是否已存在锁评论
  const comments = await this.getComments(prNumber);
  const existingLockComment = comments
    .reverse()  // 从最新开始
    .find((c: any) => c.body?.includes(LOCK_METADATA_MARKER));

  // 2. 如果存在，编辑该评论
  if (existingLockComment) {
    console.log(`[PRLock] Updating existing lock comment #${existingLockComment.id}`);
    await this.updateComment(prNumber, existingLockComment.id, body);
    return existingLockComment.id;
  } else {
    // 3. 如果不存在，创建新评论
    console.log(`[PRLock] Creating new lock comment`);
    await this.createComment(prNumber, body);

    // 获取刚创建的评论 ID
    const updatedComments = await this.getComments(prNumber);
    const newComment = updatedComments[updatedComments.length - 1];
    return newComment?.id;
  }
}
```

### 3. 添加获取 Git 分支名的方法

新增 `getCurrentBranch` 方法，自动获取当前 Git 分支：

```typescript
private getCurrentBranch(): string | undefined {
  try {
    return execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
}
```

### 4. 修改 `acquire` 方法

- 添加 `branch` 参数（可选，如果不提供则自动获取当前分支）
- 将 `branch` 添加到 `lock` 元数据中
- 保存评论 ID 到本地锁文件

```typescript
async acquire(
  prNumber: number,
  timeoutMinutes: number,
  options?: { worktreePath?: string; branch?: string; taskId?: string; reason?: string }
): Promise<LockResult> {
  // ...

  // 2. 生成锁元数据
  const now = new Date();
  const branch = options?.branch || this.getCurrentBranch();
  const lock: LockMetadata = {
    lock_id: `lock-${now.getTime()}-${Math.random().toString(36).substr(2, 9)}`,
    agent_id: this.agentId,
    worktree_path: options?.worktreePath,
    branch: branch,  // 添加分支信息
    acquired_at: now.toISOString(),
    lock_duration_minutes: timeoutMinutes,
    task_id: options?.taskId,
    reason: options?.reason
  };

  // ...

  // 4. 创建/更新锁元数据 Comment
  console.log(`[PRLock] Creating/updating lock comment with metadata`);
  const commentId = await this.updateLockComment(prNumber, lock);

  // ...

  // 7. 保存本地锁文件（包含评论 ID）
  const prLastUpdatedAt = await this.getPRLastUpdatedAt(prNumber);
  await this.saveLockState(prNumber, lock, prLastUpdatedAt, commentId);

  return { success: true, lock };
}
```

### 5. 修改 `release` 方法

- 不删除评论，而是编辑评论标记为已释放
- 设置 `lock.released = true` 和 `lock.released_at = new Date().toISOString()`
- 更新评论内容显示"🔓 **锁已释放**"

```typescript
async release(prNumber: number): Promise<LockResult> {
  console.log(`[PRLock] Releasing lock on PR #${prNumber}`);

  const lock = await this.checkLock(prNumber);

  if (!lock) {
    console.log(`[PRLock] No lock found, nothing to release`);
    return { success: true };
  }

  if (lock.agent_id !== this.agentId) {
    return {
      success: false,
      error: `Lock is held by ${lock.agent_id}, not ${this.agentId}`
    };
  }

  // 移除锁标签
  await this.removeLabel(prNumber, LOCK_LABEL);

  // 更新锁元数据：标记为已释放
  const releasedLock: LockMetadata = {
    ...lock,
    released: true,
    released_at: new Date().toISOString()
  };

  // 编辑评论标记为已释放
  const localLockState = await this.loadLockState();
  if (localLockState?.comment_id) {
    await this.updateLockCommentWithRelease(prNumber, localLockState.comment_id, releasedLock);
  } else {
    // 如果没有本地锁文件，创建新评论
    await this.createComment(prNumber, /* ... */);
  }

  console.log(`[PRLock] Lock released successfully`);

  // 删除本地锁文件
  await this.deleteLockState();

  return { success: true };
}
```

### 6. 更新锁评论格式

新的锁评论格式包含 Git 分支信息：

```markdown
<!-- LOCK_METADATA
{锁元数据 JSON}
-->

🔒 **PR 已被锁定** (或 🔓 **锁已释放**)

- 持有者：`agent_id`
- 工作目录：`worktree_path`
- Git 分支：`branch`
- 锁 ID：`lock_id`
- 获取时间：acquired_at
- 锁时长：lock_duration_minutes 分钟
- 任务：#task_id
- 原因：reason
- 释放时间：released_at (如果已释放)

**过期时间动态计算：**
过期时间 = PR 最后更新时间 + lock_duration_minutes 分钟
每次提交或评论后，锁自动延期。
```

### 7. 更新 LockState 接口

添加 `comment_id` 字段，用于保存评论 ID：

```typescript
interface LockState {
  lock_id: string;                // 锁 ID
  pr_number: number;              // PR 编号
  comment_id?: number;            // 评论 ID（用于编辑）
  acquired_at: string;            // 获取时间 ISO 8601
  lock_duration_minutes: number;  // 锁时长（分钟）
  pr_last_updated_at: string;     // PR 最后更新时间
  expires_at: string;             // 过期时间（动态计算）
}
```

---

## 验收标准

- ✅ 每个 PR 只有一个锁评论
- ✅ 释放锁时编辑评论而不是删除
- ✅ 锁元数据包含 Git 分支名
- ✅ 代码风格保持一致
- ✅ 评论 ID 保存到本地锁文件

---

## 使用示例

### 获取锁（自动获取当前分支）

```bash
bun run Scripts/lib/pr-lock.ts acquire 419 60 agent-id \
  --worktree-path="exomind-worktree-pr-419" \
  --task-id=4 \
  --reason="修复 TypeScript 类型错误"
```

### 获取锁（手动指定分支）

```bash
bun run Scripts/lib/pr-lock.ts acquire 419 60 agent-id \
  --worktree-path="exomind-worktree-pr-419" \
  --branch="feature/pr-lock-improvements" \
  --task-id=4 \
  --reason="修复 TypeScript 类型错误"
```

### 检查锁状态

```bash
bun run Scripts/lib/pr-lock.ts check 419
```

### 释放锁

```bash
bun run Scripts/lib/pr-lock.ts release 419 agent-id
```

---

## 测试

运行测试脚本验证所有功能：

```bash
bun run Scripts/test-pr-lock.ts
```

---

## 注意事项

1. **评论编辑**：每次获取锁时，如果已存在锁评论，会编辑该评论而不是创建新评论
2. **释放锁**：释放锁时会编辑评论标记为已释放，而不是删除评论
3. **分支信息**：如果不手动指定分支，会自动获取当前 Git 分支
4. **评论 ID**：评论 ID 保存在本地锁文件中，用于后续编辑

---

*更新时间: 2026-03-09*

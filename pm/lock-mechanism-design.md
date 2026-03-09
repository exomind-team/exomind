# PR Lock 机制设计文档

> 版本：v1.0
> 日期：2026-03-09
> 作者：Team pr-draft-cleanup

---

## 核心需求

在多 Agent 并行推进 PR 的场景下，需要一个分布式锁机制来解决两个核心问题：

1. **避免推进竞争**：多个 Agent 不会同时修改同一个 PR，避免上下文串扰
2. **自动解锁**：Agent 崩溃或断线时，锁能自动过期释放，避免 PR 永久锁定

---

## 设计原理

### 锁的表示

使用 **标签 + Comment** 的组合：

| 组件 | 作用 | 内容 |
|------|------|------|
| 标签 `🔒 locked` | 视觉标识 | 快速判断 PR 是否被锁定 |
| Lock Comment | 元数据存储 | JSON 格式的锁信息（持有者、过期时间等） |

### Lock Comment 格式

```markdown
<!-- LOCK_METADATA
{
  "lock_id": "lock-1773023456789-abc123",
  "agent_id": "fixer@pr-draft-cleanup",
  "acquired_at": "2026-03-09T03:10:56Z",
  "expires_at": "2026-03-09T03:15:56Z",
  "timeout_minutes": 5,
  "task_id": "4",
  "reason": "修复 PR #379 逻辑问题"
}
-->

🔒 **PR 已被锁定**

- 持有者：`fixer@pr-draft-cleanup`
- 锁 ID：`lock-1773023456789-abc123`
- 获取时间：2026-03-09 03:10:56 UTC
- 过期时间：2026-03-09 03:15:56 UTC（5 分钟后）
- 任务：#4
- 原因：修复 PR #379 逻辑问题

其他 Agent 请等待锁释放或超时后再处理此 PR。
```

---

## 核心机制

### 1. 竞争检测（Race Condition Detection）

**问题**：两个 Agent 同时尝试获取锁

```
时间线：
T0: Agent A 检查锁 → 无锁
T1: Agent B 检查锁 → 无锁
T2: Agent A 添加标签 + Comment
T3: Agent B 添加标签 + Comment
结果：两个 Agent 都认为自己获取了锁！
```

**解决方案**：时间戳仲裁

1. Agent 添加标签和 Comment 后，等待 2 秒（让 GitHub API 同步）
2. 重新查询 PR timeline，找出所有 Lock Comment
3. 比较 `lock_id` 中的时间戳（格式：`lock-{timestamp}-{random}`）
4. 时间戳最早的 Agent 是胜者，其他 Agent 主动放弃
5. 败者移除自己的标签和 Comment，并添加竞争检测日志

**代码实现**：

```typescript
// 获取锁后，检测竞争
const conflictCheck = await this.detectConflict(prNumber, myLock);

if (conflictCheck.hasConflict) {
  // 主动放弃
  await this.removeLabel(prNumber, '🔒 locked');
  await this.createComment(prNumber, '竞争检测：已主动放弃');
  return { success: false, conflict: conflictCheck };
}
```

### 2. 超时自动释放（Timeout Auto-Release）

**问题**：Agent 崩溃后，锁永久存在

**解决方案**：基于时间戳的自动过期

1. 锁元数据中包含 `expires_at` 字段
2. 任何 Agent 在获取锁前，检查现有锁是否过期
3. 如果 `now >= expires_at`，任何 Agent 都可以强制释放
4. 强制释放后，添加超时释放日志

**代码实现**：

```typescript
const existingLock = await this.checkLock(prNumber);

if (existingLock) {
  const now = new Date();
  const expiresAt = new Date(existingLock.expires_at);

  if (now >= expiresAt) {
    // 锁已过期，强制释放
    await this.forceRelease(prNumber, existingLock);
  } else {
    // 锁未过期，获取失败
    return { success: false, error: '锁未过期' };
  }
}
```

### 3. 锁的生命周期

```
┌─────────────────────────────────────────────────────────────┐
│ 1. 获取锁（Acquire）                                        │
│    ├─ 检查是否已有锁                                        │
│    ├─ 如果有锁且未过期 → 返回失败                           │
│    ├─ 如果有锁但已过期 → 强制释放                           │
│    ├─ 添加 🔒 locked 标签                                   │
│    ├─ 创建 Lock Comment                                     │
│    ├─ 等待 2 秒（API 同步）                                 │
│    ├─ 检测竞争条件                                          │
│    └─ 如果有竞争 → 主动放弃                                 │
│                                                             │
│ 2. 续期锁（Renew）                                          │
│    ├─ 验证自己是锁持有者                                    │
│    ├─ 创建新的 Lock Comment（更新 expires_at）             │
│    └─ 返回成功                                              │
│                                                             │
│ 3. 释放锁（Release）                                        │
│    ├─ 验证自己是锁持有者                                    │
│    ├─ 移除 🔒 locked 标签                                   │
│    ├─ 添加释放日志 Comment                                  │
│    └─ 返回成功                                              │
│                                                             │
│ 4. 强制释放（Force Release）                                │
│    ├─ 检查锁是否过期                                        │
│    ├─ 移除 🔒 locked 标签                                   │
│    ├─ 添加超时释放日志 Comment                              │
│    └─ 返回成功                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 使用示例

### Agent 工作流集成

```typescript
import { PRLockManager } from './Scripts/lib/pr-lock';

const lockManager = new PRLockManager(
  'exomind-team/exomind',
  'fixer@pr-draft-cleanup'
);

// Agent 开始处理 PR 前
const result = await lockManager.acquire(379, 5, {
  taskId: '4',
  reason: '修复 PR #379 逻辑问题'
});

if (!result.success) {
  console.log('无法获取锁:', result.error);
  // 跳过此 PR 或等待
  return;
}

try {
  // 处理 PR...
  await fixPR379();

  // 如果任务耗时较长，续期
  if (needMoreTime) {
    await lockManager.renew(379, 5);  // 再延长 5 分钟
  }

} finally {
  // 完成后释放锁
  await lockManager.release(379);
}
```

### CLI 工具

```bash
# 获取锁
bun Scripts/lib/pr-lock.ts acquire 379 5 fixer@team --task-id=4 --reason="修复逻辑"

# 检查锁状态
bun Scripts/lib/pr-lock.ts check 379

# 续期锁
bun Scripts/lib/pr-lock.ts renew 379 5 fixer@team

# 释放锁
bun Scripts/lib/pr-lock.ts release 379 fixer@team
```

---

## 关键设计决策

### 为什么用标签 + Comment？

| 方案 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| 单标签编码 | 简单 | 标签名过长，数量爆炸 | ❌ |
| 多标签组合 | 信息可见 | 视觉混乱，原子性问题 | ❌ |
| 标签 + Comment | 简洁、扩展性强 | 需要额外查询 | ✅ |

### 为什么用时间戳仲裁？

- GitHub API 不支持原子操作（CAS）
- 标签操作有延迟，无法保证顺序
- 时间戳是唯一可靠的全局顺序依据
- `lock_id` 格式：`lock-{timestamp}-{random}` 保证唯一性

### 为什么等待 2 秒？

- GitHub API 有延迟（通常 < 1 秒）
- 等待 2 秒确保 timeline 同步
- 避免误判竞争条件

---

## 监控和维护

### 查询所有被锁定的 PR

```bash
gh pr list --label "🔒 locked" --json number,title,labels
```

### 查询过期的锁

```bash
bun Scripts/lib/pr-lock.ts check <pr-number>
```

### 手动清理孤儿锁

如果发现有标签但没有 Comment 的"孤儿锁"：

```bash
gh label remove <pr-number> "🔒 locked"
```

---

## 未来优化

1. **GitHub Actions 定时清理**
   - 每 5 分钟扫描所有 `🔒 locked` 标签
   - 自动清理过期锁

2. **锁续期提醒**
   - Agent 在锁即将过期前 1 分钟收到提醒
   - 自动续期或主动释放

3. **锁统计分析**
   - 统计锁的平均持有时间
   - 识别经常超时的任务
   - 优化超时时间设置

---

## 相关文件

- 实现代码：`Scripts/lib/pr-lock.ts`
- 使用示例：见本文档
- 团队工作流：`CLAUDE.md` - 多 Agent 团队调度经验

---

*文档版本: v1.0*
*更新: 2026-03-09*
